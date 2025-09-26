const express = require('express');
const mongoose = require('mongoose');
const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// Validation middleware
const enrollmentValidation = [
    body('courseId').isMongoId().withMessage('Invalid course ID'),
];

const progressValidation = [
    body('progress').isInt({ min: 0, max: 100 }).withMessage('Progress must be between 0 and 100'),
    body('completedLessons').optional().isArray().withMessage('Completed lessons must be an array'),
    body('timeSpent').optional().isInt({ min: 0 }).withMessage('Time spent must be a positive integer'),
];

// Get all enrollments for a user with filtering and pagination
router.get('/', auth, async (req, res) => {
    try {
        const { page = 1, limit = 10, status, sortBy = 'enrolledAt' } = req.query;
        const query = { userId: req.user.id };
        
        if (status) query.status = status;

        const enrollments = await Enrollment.find(query)
            .populate({
                path: 'courseId',
                select: 'title description instructor duration category thumbnail'
            })
            .sort({ [sortBy]: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .lean();

        const total = await Enrollment.countDocuments(query);

        res.json({
            enrollments,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Enroll in a course with prerequisites check
router.post('/', auth, enrollmentValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { courseId } = req.body;
        const session = await mongoose.startSession();
        
        await session.withTransaction(async () => {
            // Check if course exists and is active
            const course = await Course.findById(courseId).session(session);
            if (!course || !course.isActive) {
                throw new Error('Course not found or inactive');
            }

            // Check enrollment capacity
            if (course.maxEnrollments) {
                const currentEnrollments = await Enrollment.countDocuments({ 
                    courseId, 
                    status: { $in: ['active', 'completed'] } 
                }).session(session);
                
                if (currentEnrollments >= course.maxEnrollments) {
                    throw new Error('Course enrollment is full');
                }
            }

            // Check if already enrolled
            const existingEnrollment = await Enrollment.findOne({ 
                userId: req.user.id, 
                courseId,
                status: { $in: ['active', 'completed'] }
            }).session(session);
            
            if (existingEnrollment) {
                throw new Error('Already enrolled in this course');
            }

            // Check prerequisites
            if (course.prerequisites && course.prerequisites.length > 0) {
                const completedCourses = await Enrollment.find({
                    userId: req.user.id,
                    courseId: { $in: course.prerequisites },
                    status: 'completed'
                }).session(session);

                if (completedCourses.length < course.prerequisites.length) {
                    throw new Error('Prerequisites not met');
                }
            }

            // Create enrollment
            const enrollment = new Enrollment({
                userId: req.user.id,
                courseId,
                enrolledAt: new Date(),
                status: 'active',
                progress: 0,
                completedLessons: [],
                timeSpent: 0,
                certificates: []
            });

            await enrollment.save({ session });

            // Update course enrollment count
            await Course.findByIdAndUpdate(
                courseId,
                { $inc: { enrollmentCount: 1 } },
                { session }
            );
        });

        await session.endSession();

        const populatedEnrollment = await Enrollment.findOne({
            userId: req.user.id,
            courseId
        }).populate('courseId');

        res.status(201).json(populatedEnrollment);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Get specific enrollment with detailed progress
router.get('/:id', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid enrollment ID' });
        }

        const enrollment = await Enrollment.findOne({ 
            _id: req.params.id, 
            userId: req.user.id 
        }).populate({
            path: 'courseId',
            populate: {
                path: 'lessons',
                select: 'title duration order'
            }
        });
        
        if (!enrollment) {
            return res.status(404).json({ message: 'Enrollment not found' });
        }
        
        res.json(enrollment);
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
});

// Update enrollment progress with lesson tracking
router.patch('/:id/progress', auth, progressValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { progress, completedLessons, timeSpent, currentLesson } = req.body;
        const updateData = { updatedAt: new Date() };

        if (progress !== undefined) updateData.progress = progress;
        if (completedLessons !== undefined) updateData.completedLessons = completedLessons;
        if (timeSpent !== undefined) updateData.$inc = { timeSpent };
        if (currentLesson !== undefined) updateData.currentLesson = currentLesson;

        // Mark as completed if progress is 100%
        if (progress === 100) {
            updateData.status = 'completed';
            updateData.completedAt = new Date();
        }

        const enrollment = await Enrollment.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id, status: 'active' },
            updateData,
            { new: true, runValidators: true }
        ).populate('courseId');
        
        if (!enrollment) {
            return res.status(404).json({ message: 'Active enrollment not found' });
        }

        // Generate certificate if course is completed
        if (enrollment.status === 'completed' && !enrollment.certificates.length) {
            enrollment.certificates.push({
                issuedAt: new Date(),
                certificateId: `CERT-${enrollment._id}-${Date.now()}`
            });
            await enrollment.save();
        }
        
        res.json(enrollment);
    } catch (error) {
        res.status(400).json({ message: 'Update failed', error: error.message });
    }
});

// Suspend/Resume enrollment
router.patch('/:id/status', auth, async (req, res) => {
    try {
        const { status } = req.body;
        const validStatuses = ['active', 'suspended', 'cancelled'];
        
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const enrollment = await Enrollment.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { status, updatedAt: new Date() },
            { new: true }
        ).populate('courseId');
        
        if (!enrollment) {
            return res.status(404).json({ message: 'Enrollment not found' });
        }
        
        res.json(enrollment);
    } catch (error) {
        res.status(400).json({ message: 'Status update failed', error: error.message });
    }
});

// Get enrollment statistics
router.get('/stats/dashboard', auth, async (req, res) => {
    try {
        const stats = await Enrollment.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(req.user.id) } },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    avgProgress: { $avg: '$progress' },
                    totalTimeSpent: { $sum: '$timeSpent' }
                }
            }
        ]);

        const recentActivity = await Enrollment.find({ userId: req.user.id })
            .sort({ updatedAt: -1 })
            .limit(5)
            .populate('courseId', 'title thumbnail');

        res.json({ stats, recentActivity });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch stats', error: error.message });
    }
});

// Unenroll from course (soft delete)
router.delete('/:id', auth, async (req, res) => {
    try {
        const enrollment = await Enrollment.findOneAndUpdate(
            { _id: req.params.id, userId: req.user.id },
            { 
                status: 'cancelled', 
                cancelledAt: new Date(),
                updatedAt: new Date()
            },
            { new: true }
        );
        
        if (!enrollment) {
            return res.status(404).json({ message: 'Enrollment not found' });
        }

        // Update course enrollment count
        await Course.findByIdAndUpdate(
            enrollment.courseId,
            { $inc: { enrollmentCount: -1 } }
        );
        
        res.json({ message: 'Successfully unenrolled', enrollment });
    } catch (error) {
        res.status(500).json({ message: 'Unenrollment failed', error: error.message });
    }
});

module.exports = router;