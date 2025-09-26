const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    course: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    comment: {
        type: String,
        required: true,
        maxlength: 500
    },
    isApproved: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Prevent duplicate reviews from same user for same course
reviewSchema.index({ course: 1, user: 1 }, { unique: true });

// Calculate average rating for course
reviewSchema.statics.getAverageRating = async function(courseId) {
    const result = await this.aggregate([
        {
            $match: { course: courseId, isApproved: true }
        },
        {
            $group: {
                _id: '$course',
                averageRating: { $avg: '$rating' },
                totalReviews: { $sum: 1 }
            }
        }
    ]);

    try {
        await this.model('Course').findByIdAndUpdate(courseId, {
            averageRating: result[0]?.averageRating || 0,
            totalReviews: result[0]?.totalReviews || 0
        });
    } catch (error) {
        console.error(error);
    }
};

// Update course rating after save
reviewSchema.post('save', function() {
    this.constructor.getAverageRating(this.course);
});

// Update course rating after remove
reviewSchema.post('remove', function() {
    this.constructor.getAverageRating(this.course);
});

module.exports = mongoose.model('Review', reviewSchema);