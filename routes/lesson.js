const express = require('express');
const Lesson = require('../models/Lesson');
const Course = require('../models/Course');
const Progress = require('../models/Progress');
const auth = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');

const router = express.Router();

// Get all lessons with filtering and pagination
router.get('/', auth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        const filter = {};
        if (req.query.course) filter.course = req.query.course;
        if (req.query.published !== undefined) filter.published = req.query.published === 'true';

        const lessons = await Lesson.find(filter)
            .populate('course', 'title description')
            .sort({ course: 1, order: 1 })
            .skip(skip)
            .limit(limit);

        const total = await Lesson.countDocuments(filter);

        res.json({
            lessons,
            pagination: {
                current: page,
                pages: Math.ceil(total / limit),
                total
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch lessons', error: error.message });
    }
});

// Get lessons by course
router.get('/course/:courseId', auth, async (req, res) => {
    try {
        const { courseId } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
            return res.status(400).json({ message: 'Invalid course ID' });
        }

        const lessons = await Lesson.find({ course: courseId })
            .populate('course', 'title')
            .sort({ order: 1 });

        // Get user progress for these lessons
        const progress = await Progress.find({
            user: req.user.id,
            lesson: { $in: lessons.map(l => l._id) }
        });

        const progressMap = progress.reduce((acc, p) => {
            acc[p.lesson] = p;
            return acc;
        }, {});

        const lessonsWithProgress = lessons.map(lesson => ({
            ...lesson.toObject(),
            progress: progressMap[lesson._id] || null
        }));

        res.json(lessonsWithProgress);
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch course lessons', error: error.message });
    }
});

// Get lesson by ID with progress
router.get('/:id', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid lesson ID' });
        }

        const lesson = await Lesson.findById(req.params.id)
            .populate('course', 'title description instructor');

        if (!lesson) {
            return res.status(404).json({ message: 'Lesson not found' });
        }

        // Get user progress for this lesson
        const progress = await Progress.findOne({
            user: req.user.id,
            lesson: lesson._id
        });

        res.json({
            ...lesson.toObject(),
            progress: progress || null
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch lesson', error: error.message });
    }
});

// Create new lesson
router.post('/', 
    auth,
    [
        body('title').trim().notEmpty().withMessage('Title is required'),
        body('content').trim().notEmpty().withMessage('Content is required'),
        body('course').isMongoId().withMessage('Valid Course ID is required'),
        body('order').isInt({ min: 1 }).withMessage('Order must be a positive integer'),
        body('duration').optional().isInt({ min: 1 }).withMessage('Duration must be a positive integer'),
        body('videoUrl').optional().isURL().withMessage('Video URL must be valid'),
        body('published').optional().isBoolean().withMessage('Published must be boolean')
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ 
                    message: 'Validation failed',
                    errors: errors.array() 
                });
            }

            // Verify course exists
            const course = await Course.findById(req.body.course);
            if (!course) {
                return res.status(404).json({ message: 'Course not found' });
            }

            // Check if order already exists for this course
            const existingLesson = await Lesson.findOne({
                course: req.body.course,
                order: req.body.order
            });

            if (existingLesson) {
                return res.status(409).json({ 
                    message: 'Lesson order already exists for this course' 
                });
            }

            const lesson = new Lesson({
                title: req.body.title,
                content: req.body.content,
                course: req.body.course,
                order: req.body.order,
                duration: req.body.duration || 0,
                videoUrl: req.body.videoUrl,
                resources: req.body.resources || [],
                published: req.body.published || false,
                createdBy: req.user.id
            });

            const savedLesson = await lesson.save();
            await savedLesson.populate('course', 'title');
            
            res.status(201).json({
                message: 'Lesson created successfully',
                lesson: savedLesson
            });
        } catch (error) {
            res.status(400).json({ 
                message: 'Failed to create lesson', 
                error: error.message 
            });
        }
    }
);

// Update lesson
router.put('/:id', 
    auth,
    [
        body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
        body('content').optional().trim().notEmpty().withMessage('Content cannot be empty'),
        body('order').optional().isInt({ min: 1 }).withMessage('Order must be a positive integer'),
        body('duration').optional().isInt({ min: 1 }).withMessage('Duration must be a positive integer'),
        body('videoUrl').optional().isURL().withMessage('Video URL must be valid'),
        body('published').optional().isBoolean().withMessage('Published must be boolean')
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ 
                    message: 'Validation failed',
                    errors: errors.array() 
                });
            }

            if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
                return res.status(400).json({ message: 'Invalid lesson ID' });
            }

            // Check if order conflicts with existing lessons
            if (req.body.order) {
                const lesson = await Lesson.findById(req.params.id);
                if (!lesson) {
                    return res.status(404).json({ message: 'Lesson not found' });
                }

                const conflictingLesson = await Lesson.findOne({
                    course: lesson.course,
                    order: req.body.order,
                    _id: { $ne: req.params.id }
                });

                if (conflictingLesson) {
                    return res.status(409).json({ 
                        message: 'Lesson order already exists for this course' 
                    });
                }
            }

            const updatedLesson = await Lesson.findByIdAndUpdate(
                req.params.id,
                { 
                    ...req.body,
                    updatedAt: new Date(),
                    updatedBy: req.user.id
                },
                { new: true, runValidators: true }
            ).populate('course', 'title');

            if (!updatedLesson) {
                return res.status(404).json({ message: 'Lesson not found' });
            }

            res.json({
                message: 'Lesson updated successfully',
                lesson: updatedLesson
            });
        } catch (error) {
            res.status(400).json({ 
                message: 'Failed to update lesson', 
                error: error.message 
            });
        }
    }
);

// Delete lesson
router.delete('/:id', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid lesson ID' });
        }

        const lesson = await Lesson.findByIdAndDelete(req.params.id);
        if (!lesson) {
            return res.status(404).json({ message: 'Lesson not found' });
        }

        // Clean up related progress records
        await Progress.deleteMany({ lesson: req.params.id });

        res.json({ message: 'Lesson deleted successfully' });
    } catch (error) {
        res.status(500).json({ 
            message: 'Failed to delete lesson', 
            error: error.message 
        });
    }
});

// Mark lesson as completed
router.post('/:id/complete', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ message: 'Invalid lesson ID' });
        }

        const lesson = await Lesson.findById(req.params.id);
        if (!lesson) {
            return res.status(404).json({ message: 'Lesson not found' });
        }

        // Check if already completed
        let progress = await Progress.findOne({
            user: req.user.id,
            lesson: req.params.id
        });

        if (progress && progress.completed) {
            return res.json({ 
                message: 'Lesson already completed',
                progress 
            });
        }

        // Create or update progress
        progress = await Progress.findOneAndUpdate(
            { user: req.user.id, lesson: req.params.id },
            {
                user: req.user.id,
                lesson: req.params.id,
                course: lesson.course,
                completed: true,
                completedAt: new Date(),
                progress: 100
            },
            { upsert: true, new: true }
        );

        res.json({ 
            message: 'Lesson marked as completed',
            progress 
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'Failed to mark lesson as completed', 
            error: error.message 
        });
    }
});

// Update lesson progress
router.put('/:id/progress', auth, async (req, res) => {
    try {
        const { progress: progressPercent, timeSpent } = req.body;

        if (progressPercent < 0 || progressPercent > 100) {
            return res.status(400).json({ 
                message: 'Progress must be between 0 and 100' 
            });
        }

        const lesson = await Lesson.findById(req.params.id);
        if (!lesson) {
            return res.status(404).json({ message: 'Lesson not found' });
        }

        const progress = await Progress.findOneAndUpdate(
            { user: req.user.id, lesson: req.params.id },
            {
                user: req.user.id,
                lesson: req.params.id,
                course: lesson.course,
                progress: progressPercent,
                timeSpent: timeSpent || 0,
                completed: progressPercent >= 100,
                completedAt: progressPercent >= 100 ? new Date() : null,
                lastAccessed: new Date()
            },
            { upsert: true, new: true }
        );

        res.json({ 
            message: 'Progress updated successfully',
            progress 
        });
    } catch (error) {
        res.status(500).json({ 
            message: 'Failed to update progress', 
            error: error.message 
        });
    }
});

// Reorder lessons in a course
router.put('/course/:courseId/reorder', auth, async (req, res) => {
    try {
        const { lessons } = req.body; // Array of { id, order }

        if (!Array.isArray(lessons)) {
            return res.status(400).json({ message: 'Lessons must be an array' });
        }

        // Update lessons in parallel
        const updates = lessons.map(({ id, order }) => 
            Lesson.findByIdAndUpdate(id, { order }, { new: true })
        );

        await Promise.all(updates);

        res.json({ message: 'Lessons reordered successfully' });
    } catch (error) {
        res.status(500).json({ 
            message: 'Failed to reorder lessons', 
            error: error.message 
        });
    }
});

module.exports = router;