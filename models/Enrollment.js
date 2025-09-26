const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema({
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    course: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true
    },
    enrolledAt: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['active', 'completed', 'dropped', 'suspended'],
        default: 'active'
    },
    progress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    completedLessons: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lesson'
    }],
    grade: {
        type: Number,
        min: 0,
        max: 100
    },
    completedAt: {
        type: Date
    },
    lastAccessedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Compound index to prevent duplicate enrollments
enrollmentSchema.index({ student: 1, course: 1 }, { unique: true });

// Index for querying by student
enrollmentSchema.index({ student: 1 });

// Index for querying by course
enrollmentSchema.index({ course: 1 });

// Virtual for enrollment duration
enrollmentSchema.virtual('duration').get(function() {
    if (this.completedAt) {
        return this.completedAt - this.enrolledAt;
    }
    return Date.now() - this.enrolledAt;
});

// Method to update progress
enrollmentSchema.methods.updateProgress = function(lessonId) {
    if (!this.completedLessons.includes(lessonId)) {
        this.completedLessons.push(lessonId);
    }
    this.lastAccessedAt = new Date();
    return this.save();
};

// Method to complete enrollment
enrollmentSchema.methods.complete = function(finalGrade) {
    this.status = 'completed';
    this.progress = 100;
    this.completedAt = new Date();
    if (finalGrade !== undefined) {
        this.grade = finalGrade;
    }
    return this.save();
};

// Static method to get enrollment stats
enrollmentSchema.statics.getEnrollmentStats = function(courseId) {
    return this.aggregate([
        { $match: { course: mongoose.Types.ObjectId(courseId) } },
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                avgProgress: { $avg: '$progress' }
            }
        }
    ]);
};

module.exports = mongoose.model('Enrollment', enrollmentSchema);