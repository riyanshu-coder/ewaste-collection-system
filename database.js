
const Database = require('better-sqlite3');

const db = new Database('ewaste.db');

db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL,
        address TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recycling_centres (
        centre_id INTEGER PRIMARY KEY AUTOINCREMENT,
        centre_name TEXT NOT NULL,
        address TEXT NOT NULL,
        city TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_requests (
        request_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        centre_id INTEGER,
        item_type TEXT NOT NULL,
        item_condition TEXT NOT NULL,
        estimated_weight REAL NOT NULL,
        actual_weight REAL DEFAULT 0,
        collection_date TEXT,
        status TEXT NOT NULL DEFAULT 'Pending',
        FOREIGN KEY (user_id) REFERENCES users(user_id),
        FOREIGN KEY (centre_id) REFERENCES recycling_centres(centre_id)
    );
`);
// Insert sample recycling centres
const insertCentre = db.prepare(`
    INSERT INTO recycling_centres (centre_name, address, city)
    VALUES (?, ?, ?)
`);

const centreCount = db.prepare(
    'SELECT COUNT(*) AS count FROM recycling_centres'
).get();

if (centreCount.count === 0) {
    insertCentre.run(
        'Green Earth Recycling Centre',
        'Salt Lake',
        'Kolkata'
    );

    insertCentre.run(
        'Eco-Friendly E-Waste Centre',
        'New Town',
        'Kolkata'
    );

    insertCentre.run(
        'Tech Recycle Centre',
        'Park Street',
        'Kolkata'
    );
}

console.log('Database and tables created successfully!');

module.exports = db;
