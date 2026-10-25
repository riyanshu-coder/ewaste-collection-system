
const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Home page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get all recycling centres
app.get('/api/centres', (req, res) => {
    try {
        const centres = db.prepare(
            'SELECT * FROM recycling_centres'
        ).all();

        res.json(centres);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch centres' });
    }
});

// Register a user
app.post('/api/users', (req, res) => {
    try {
        const { name, email, phone, address } = req.body;

        if (!name || !email || !phone || !address) {
            return res.status(400).json({
                error: 'All fields are required'
            });
        }

        const result = db.prepare(`
            INSERT INTO users (name, email, phone, address)
            VALUES (?, ?, ?, ?)
        `).run(name, email, phone, address);

        res.status(201).json({
            message: 'User registered successfully!',
            user_id: result.lastInsertRowid
        });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({
                error: 'Email already registered'
            });
        }

        res.status(500).json({ error: 'Failed to register user' });
    }
});

// Create a collection request
app.post('/api/requests', (req, res) => {
    try {
        const {
            user_id,
            centre_id,
            item_type,
            item_condition,
            estimated_weight,
            collection_date
        } = req.body;

        if (
            !user_id ||
            !item_type ||
            !item_condition ||
            estimated_weight === undefined ||
            estimated_weight === null ||
            estimated_weight === '' ||
            !Number.isFinite(Number(estimated_weight)) ||
            Number(estimated_weight) <= 0
        ) {
            return res.status(400).json({
                error: 'Please provide valid required fields'
            });
        }

        const result = db.prepare(`
            INSERT INTO collection_requests
            (user_id, centre_id, item_type, item_condition,
             estimated_weight, collection_date)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            Number(user_id),
            centre_id ? Number(centre_id) : null,
            item_type,
            item_condition,
            Number(estimated_weight),
            collection_date || null
        );

        res.status(201).json({
            message: 'Collection request submitted successfully!',
            request_id: result.lastInsertRowid
        });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
            return res.status(400).json({
                error: 'Invalid user ID or recycling centre ID'
            });
        }

        res.status(500).json({
            error: 'Failed to submit collection request'
        });
    }
});

// Get all collection requests
app.get('/api/requests', (req, res) => {
    try {
        const requests = db.prepare(`
            SELECT cr.*, u.name AS user_name,
                   rc.centre_name
            FROM collection_requests cr
            JOIN users u ON cr.user_id = u.user_id
            LEFT JOIN recycling_centres rc
                ON cr.centre_id = rc.centre_id
            ORDER BY cr.request_id DESC
        `).all();

        res.json(requests);
    } catch (error) {
        res.status(500).json({
            error: 'Failed to fetch requests'
        });
    }
});
// Dashboard Summary
app.get('/api/dashboard', (req, res) => {
    try {
        const users = db.prepare(`
            SELECT COUNT(*) AS total FROM users
        `).get().total;

        const requests = db.prepare(`
            SELECT COUNT(*) AS total
            FROM collection_requests
        `).get().total;

        const pending = db.prepare(`
            SELECT COUNT(*) AS total
            FROM collection_requests
            WHERE status = 'Pending'
        `).get().total;

        const collected = db.prepare(`
            SELECT COUNT(*) AS total
            FROM collection_requests
            WHERE status = 'Collected'
        `).get().total;

        const recycled = db.prepare(`
            SELECT COUNT(*) AS total
            FROM collection_requests
            WHERE status = 'Recycled'
        `).get().total;

        const weight = db.prepare(`
            SELECT COALESCE(SUM(actual_weight), 0) AS total
            FROM collection_requests
            WHERE status IN ('Collected', 'Recycled')
        `).get().total;

        res.json({
            totalUsers: users,
            totalRequests: requests,
            pendingRequests: pending,
            collectedRequests: collected,
            recycledRequests: recycled,
            totalCollectedWeight: weight
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: 'Failed to load dashboard'
        });
    }
});

 // Update collection request status

app.put('/api/requests/:id/status', (req, res) => {
    try {
        const { status, actualWeight } = req.body;
        const { id } = req.params;

        const allowedStatuses = ['Pending', 'Collected', 'Recycled'];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                error: 'Invalid status'
            });
        }

        let result;

        if (status === 'Collected' || status === 'Recycled') {
            const weight = Number(actualWeight);

            if (
                actualWeight === undefined ||
                actualWeight === null ||
                actualWeight === '' ||
                !Number.isFinite(weight) ||
                weight < 0
            ) {
                return res.status(400).json({
                    error: 'Please enter a valid actual weight'
                });
            }

            result = db.prepare(`
                UPDATE collection_requests
                SET status = ?, actual_weight = ?
                WHERE request_id = ?
            `).run(status, weight, id);

        } else {
            result = db.prepare(`
                UPDATE collection_requests
                SET status = ?
                WHERE request_id = ?
            `).run(status, id);
        }

        if (result.changes === 0) {
            return res.status(404).json({
                error: 'Collection request not found'
            });
        }

        res.json({
            message: 'Request status and weight updated successfully'
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: 'Failed to update request status and weight'
        });
    }
});
// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
