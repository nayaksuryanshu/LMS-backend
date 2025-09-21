const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Validation middleware
const registerValidation = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage('Name must be between 2 and 50 characters'),
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Please provide a valid email'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    body('role')
        .optional()
        .isIn(['student', 'instructor', 'admin'])
        .withMessage('Role must be either student, instructor, or admin')
];

const loginValidation = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Please provide a valid email'),
    body('password')
        .notEmpty()
        .withMessage('Password is required')
];

// Validation error handler middleware
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array().map(error => ({
                field: error.path,
                message: error.msg
            }))
        });
    }
    next();
};

// Consistent response helper
const sendResponse = (res, statusCode, success, message, data = null) => {
    const response = {
        success,
        message
    };
    
    if (data) {
        response.data = data;
    }
    
    return res.status(statusCode).json(response);
};

router.post('/register', registerValidation, handleValidationErrors, async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        // Check if user exists
        let user = await User.findOne({ email });
        if (user) {
            return sendResponse(res, 409, false, 'User with this email already exists');
        }

        // Create new user (password will be hashed by pre-save hook)
        user = new User({
            name,
            email,
            password,
            role: role || 'student'
        });

        await user.save();

        // Generate JWT token
        const payload = {
            id: user.id,
            role: user.role
        };

        // Check if JWT_SECRET is defined
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET environment variable is not defined');
            return sendResponse(res, 500, false, 'Server configuration error');
        }

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '24h' },
            (err, token) => {
                if (err) {
                    console.error('JWT signing error:', err);
                    return sendResponse(res, 500, false, 'Error generating authentication token');
                }
                
                sendResponse(res, 201, true, 'User registered successfully', {
                    token,
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        role: user.role
                    }
                });
            }
        );
    } catch (error) {
        console.error('Registration error:', error);
        
        // Handle duplicate key error
        if (error.code === 11000) {
            return sendResponse(res, 409, false, 'User with this email already exists');
        }
        
        sendResponse(res, 500, false, 'Internal server error');
    }
});

router.post('/login', loginValidation, handleValidationErrors, async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check if user exists (explicitly select password)
        let user = await User.findOne({ email }).select('+password');
        if (!user) {
            return sendResponse(res, 401, false, 'Invalid email or password');
        }

        // Validate password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return sendResponse(res, 401, false, 'Invalid email or password');
        }

        // Generate JWT token
        const payload = {
            id: user.id,
            role: user.role
        };

        // Check if JWT_SECRET is defined
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET environment variable is not defined');
            return sendResponse(res, 500, false, 'Server configuration error');
        }

        try {
            const token = jwt.sign(
                payload,
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );
            
            sendResponse(res, 200, true, 'Login successful', {
                token,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role
                }
            });
        } catch (jwtError) {
            console.error('JWT signing error:', jwtError);
            return sendResponse(res, 500, false, 'Error generating authentication token');
        }
    } catch (error) {
        console.error('Login error:', error);
        sendResponse(res, 500, false, 'Internal server error');
    }
});

// Get current user
router.get('/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return sendResponse(res, 404, false, 'User not found');
        }
        
        sendResponse(res, 200, true, 'User profile retrieved successfully', { user });
    } catch (error) {
        console.error('Get user profile error:', error);
        sendResponse(res, 500, false, 'Internal server error');
    }
});

// Logout user (client-side token removal)
router.post('/logout', (req, res) => {
    sendResponse(res, 200, true, 'Logged out successfully');
});

module.exports = router;