const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
`      `
// --- MSSQL Connection Configuration ---
const config = {
    user: 'sa',
    password: 'RaySmartSoft',
    server: '127.0.0.1',
    port: 1433,
    database: 'TukDB',
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

sql.connect(config).then(pool => {
    if (pool.connected) {
        console.log("✅ SQL Server එකට සාර්ථකව සම්බන්ධ වුණා!");
        const createTables = `
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' AND xtype='U')
            CREATE TABLE Users (
                id INT PRIMARY KEY IDENTITY(1,1),
                name NVARCHAR(100),
                user_id NVARCHAR(100) UNIQUE,
                password NVARCHAR(100),
                created_at DATETIME DEFAULT GETDATE()
            );

            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Hires' AND xtype='U')
            CREATE TABLE Hires (
                id INT PRIMARY KEY IDENTITY(1,1),
                destination NVARCHAR(MAX),
                amount DECIMAL(10,2),
                added_date DATETIME DEFAULT GETDATE(),
                user_id NVARCHAR(100)
            ) ELSE IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Hires') AND name = 'user_id')
            ALTER TABLE Hires ADD user_id NVARCHAR(100);

            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Expenses' AND xtype='U')
            CREATE TABLE Expenses (
                id BIGINT PRIMARY KEY,
                type NVARCHAR(100),
                amount DECIMAL(10,2),
                note NVARCHAR(MAX),
                date DATETIME,
                archived BIT,
                user_id NVARCHAR(100)
            ) ELSE IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Expenses') AND name = 'user_id')
            ALTER TABLE Expenses ADD user_id NVARCHAR(100);

            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DayEndLogs' AND xtype='U')
            CREATE TABLE DayEndLogs (
                date NVARCHAR(100),
                trips_count INT,
                income DECIMAL(10,2),
                expenses DECIMAL(10,2),
                profit DECIMAL(10,2),
                closedAt DATETIME,
                user_id NVARCHAR(100)
            ) ELSE IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('DayEndLogs') AND name = 'user_id')
            ALTER TABLE DayEndLogs ADD user_id NVARCHAR(100);
        `;
        pool.request().query(createTables)
            .then(() => console.log("✅ Database tables checked/created"))
            .catch(err => console.error("Table Error:", err));
    }
}).catch(err => {
    console.error("❌ SQL Connection Error:", err.message);
});

// 4. User Signup
app.post('/signup', async (req, res) => {
    try {
        let pool = await sql.connect(config);
        const { name, id, pass } = req.body;

        const check = await pool.request()
            .input('uid', sql.NVarChar, id)
            .query('SELECT 1 FROM Users WHERE user_id = @uid');

        if (check.recordset.length > 0) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }

        await pool.request()
            .input('name', sql.NVarChar, name)
            .input('uid', sql.NVarChar, id)
            .input('pass', sql.NVarChar, pass)
            .query('INSERT INTO Users (name, user_id, password) VALUES (@name, @uid, @pass)');

        res.status(200).json({ success: true, user: { name, id } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 5. User Login
app.post('/login', async (req, res) => {
    try {
        let pool = await sql.connect(config);
        const { id, pass } = req.body;

        const result = await pool.request()
            .input('uid', sql.NVarChar, id)
            .input('pass', sql.NVarChar, pass)
            .query('SELECT name, user_id FROM Users WHERE user_id = @uid AND password = @pass');

        if (result.recordset.length > 0) {
            res.status(200).json({ success: true, user: { name: result.recordset[0].name, id: result.recordset[0].user_id } });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 1. Hire එකක් Save කිරීම
app.post('/add-hire', async (req, res) => {
    try {
        let pool = await sql.connect(config);
        await pool.request()
            .input('dest', sql.NVarChar, req.body.destination)
            .input('amt', sql.Decimal(10, 2), req.body.amount)
            .input('uid', sql.NVarChar, req.body.user_id)
            .query('IF NOT EXISTS (SELECT 1 FROM Hires WHERE destination = @dest AND amount = @amt AND user_id = @uid AND DATEDIFF(minute, added_date, GETDATE()) < 1) INSERT INTO Hires (destination, amount, user_id) VALUES (@dest, @amt, @uid)');
        res.status(200).json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. Expense එකක් Save කිරීම
app.post('/add-expense', async (req, res) => {
    try {
        let pool = await sql.connect(config);
        await pool.request()
            .input('id', sql.BigInt, req.body.id)
            .input('type', sql.NVarChar, req.body.type)
            .input('amt', sql.Decimal(10, 2), req.body.amount)
            .input('note', sql.NVarChar, req.body.note)
            .input('date', sql.DateTime, req.body.date)
            .input('arch', sql.Bit, req.body.archived ? 1 : 0)
            .input('uid', sql.NVarChar, req.body.user_id)
            .query('IF NOT EXISTS (SELECT 1 FROM Expenses WHERE id = @id) INSERT INTO Expenses (id, type, amount, note, date, archived, user_id) VALUES (@id, @type, @amt, @note, @date, @arch, @uid)');
        res.status(200).json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. Day End Log එකක් Save කිරීම
app.post('/add-day-end', async (req, res) => {
    try {
        let pool = await sql.connect(config);
        await pool.request()
            .input('date', sql.NVarChar, req.body.date)
            .input('trips', sql.Int, req.body.trips)
            .input('inc', sql.Decimal(10, 2), req.body.income)
            .input('exp', sql.Decimal(10, 2), req.body.expenses)
            .input('prof', sql.Decimal(10, 2), req.body.profit)
            .input('closed', sql.DateTime, req.body.closedAt)
            .input('uid', sql.NVarChar, req.body.user_id)
            .query(`
                MERGE DayEndLogs AS target
                USING (SELECT @date AS date, @uid AS user_id) AS source ON target.date = source.date AND target.user_id = source.user_id
                WHEN MATCHED THEN
                    UPDATE SET trips_count=@trips, income=@inc, expenses=@exp, profit=@prof, closedAt=@closed
                WHEN NOT MATCHED THEN
                    INSERT (date, trips_count, income, expenses, profit, closedAt, user_id)
                    VALUES (@date, @trips, @inc, @exp, @prof, @closed, @uid);
            `);
        res.status(200).json({ success: true });
    } catch (err) {
        console.error("DayEnd SQL Error:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.listen(3000, () => console.log('🚀 Bridge Server එක port 3000 රන් වෙනවා...'));