const Enrollment = require('../models/Enrollment');
const Course = require('../models/Course');
const User = require('../models/User');

// Check if user is enrolled in course
const checkEnrollment = async (req, res, next) => {
    try {
        const { courseId } = req.params;
        const userId = req.user.id;

        const enrollment = await Enrollment.findOne({
            user: userId,
            course: courseId,
            status: 'active'
        });

        if (!enrollment) {
            return res.status(403).json({
                success: false,
                message: 'You are not enrolled in this course'
            });
        }

        req.enrollment = enrollment;
        next();
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// Check enrollment capacity
const checkCapacity = async (req, res, next) => {
    try {
        const { courseId } = req.body;
        
        const course = await Course.findById(courseId);
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        const enrollmentCount = await Enrollment.countDocuments({
            course: courseId,
            status: 'active'
        });

        if (enrollmentCount >= course.capacity) {
            return res.status(400).json({
                success: false,
                message: 'Course is full'
            });
        }

        next();
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// Validate enrollment data
const validateEnrollment = (req, res, next) => {
    const { courseId } = req.body;
    
    if (!courseId) {
        return res.status(400).json({
            success: false,
            message: 'Course ID is required'
        });
    }

    next();
};

module.exports = {
    checkEnrollment,
    checkCapacity,
    validateEnrollment
};