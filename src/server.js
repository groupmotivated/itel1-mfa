require('dotenv').config();
const express = require('express');
const bodyParser = require("body-parser");
const cookieParser = require('cookie-parser');
const session = require('express-session');
const mysql = require("mysql2");
let ejs = require('ejs');
const path = require('path');

// MySQL Server Authentication guides. Please acquire a .env from server.
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    port: process.env.DB_PORT,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: {
        rejectUnauthorized: false // Because I can't find the CA File to embed. Crazy hack indeed
    }
}).promise();


// Create Express app
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Set to true if using HTTPS
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
}));
// Set EJS as the view engine
app.set('view engine', 'ejs');


// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        return next();
    }
    res.redirect('/login');
};

// Middleware to check if user is NOT authenticated (for login/register pages)
const isNotAuthenticated = (req, res, next) => {
    if (!req.session.userId) {
        return next();
    }
    res.redirect('/summary');
};


// Serve assets
app.use('/assets', express.static('assets'));
app.get("/style/main.css", function(req, res){
    res.sendFile(__dirname + "/style/main.css");
})
// Serve Bootstrap CSS
app.use('/dist/bootstrap/css', express.static(path.join(__dirname, '../node_modules/bootstrap/dist/css')));
app.use('/dist/bootstrap/js', express.static(path.join(__dirname, '../node_modules/bootstrap/dist/js')));
app.use('/dist/bootstrap-icons/fonts', express.static(path.join(__dirname, '../node_modules/bootstrap-icons/font/')));

// Specify the directory where your EJS template files are located
app.set('views', path.join(__dirname, 'views'));

// Helper function to pass authentication data to baseof template
const renderPage = (req, res, viewName, pageTitle, pageData = {}) => {
    res.render(viewName, { title: pageTitle, data: pageData }, (err, pageContent) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error rendering page');
        }
        res.render('baseof', { 
            title: pageTitle, 
            body: pageContent,
            isAuthenticated: !!req.session.userId,
            username: req.session.username
        });
    });
};


// Home page route. will show summary if authenticated, 
// will show default home when not authenticated. 
app.get('/', (req, res) => {
    const pageTitle = 'Home';
    const pageData = {
        username: req.session.username
    };
    renderPage(req, res, 'index', pageTitle, pageData);
});

// Routes to render /login page
app.get('/login', isNotAuthenticated, (req, res) => {
    const pageTitle = 'Login';
    const pageData = {
        errorMessage: null,
        successMessage: null
    }
    renderPage(req, res, 'login', pageTitle, pageData);
});

// Routes to render /register page
app.get('/register', isNotAuthenticated, (req, res) => {
    const pageTitle = 'Register';
    const pageData = {
        errorMessage: null,
        successMessage: null
    }
    renderPage(req, res, 'register', pageTitle, pageData);
});


// POST route for login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    const pageTitle = 'Login';
    const pageData = {
        errorMessage: null,
        successMessage: null
    };

    try {
        // Query database for user with matching credentials
        const [users] = await db.query(
            `SELECT * FROM user WHERE username = ? AND password = ?`,
            [username, password]
        );

        if (users.length === 0) {
            pageData.errorMessage = "Invalid username or password!";
            return renderPage(req, res, 'login', pageTitle, pageData);
        }

        // User found - store user info in session
        req.session.userId = users[0].uid;
        req.session.username = users[0].username;
        
        // Redirect to summary page
        return res.redirect('/');

    } catch (err) {
        console.error("Database error:", err);
        pageData.errorMessage = "Database error!";
        return renderPage(req, res, 'login', pageTitle, pageData);
    }
});


app.post('/register', async (req, res) => {
    const { username, name, email, password } = req.body;

    const pageTitle = 'Register';
    const pageData = {
        errorMessage: null,
        successMessage: null
    };

    try {
        // Insert into correct columns (uid auto-incremented)
        await db.query(
            `INSERT INTO user (username, name, email, password)
             VALUES (?, ?, ?, ?)`,
            [username, name, email, password]
        );

        pageData.successMessage = "User registered successfully! You can now <a href='/login'>login</a>.";

        return renderPage(req, res, 'register', pageTitle, pageData);

    } catch (err) {
        console.error("Database error:", err);

        if (err.code === "ER_DUP_ENTRY") {
            pageData.errorMessage = "Username or email is already registered!";
            return renderPage(req, res, 'register', pageTitle, pageData);
        }

        pageData.errorMessage = "Database error!";
        return renderPage(req, res, 'register', pageTitle, pageData);
    }
});



// Summary page (protected - requires authentication)
app.get('/income', isAuthenticated, async (req, res) => {
    const pageTitle = 'Income';
    const pageData = {
        username: req.session.username,
        transactions: [],
        currentBudget: 0,
        thisMonthIncome: 0
    };
    
    try {
        // Fetch all income transactions for the logged-in user
        const [transactions] = await db.query(
            `SELECT date, amount, description FROM transactions 
             WHERE userid = ? AND type = 'income' 
             ORDER BY date DESC`,
            [req.session.userId]
        );
        
        pageData.transactions = transactions;
        
        // Calculate current budget (total income - total expenses)
        const [budgetResult] = await db.query(
            `SELECT 
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) as budget
             FROM transactions 
             WHERE userid = ?`,
            [req.session.userId]
        );
        
        pageData.currentBudget = budgetResult[0]?.budget || 0;
        
        // Calculate this month's income
        const [monthlyResult] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as monthlyIncome
             FROM transactions 
             WHERE userid = ? AND type = 'income' 
             AND MONTH(date) = MONTH(NOW()) 
             AND YEAR(date) = YEAR(NOW())`,
            [req.session.userId]
        );
        
        pageData.thisMonthIncome = monthlyResult[0]?.monthlyIncome || 0;
        
    } catch (err) {
        console.error("Error fetching transactions:", err);
    }
    
    renderPage(req, res, 'income', pageTitle, pageData);
});

// POST route to add new income
app.post('/income', isAuthenticated, async (req, res) => {
    const { amount, source } = req.body;
    const userId = req.session.userId;
    
    try {
        await db.query(
            `INSERT INTO transactions (userid, date, amount, type, description) 
             VALUES (?, NOW(), ?, 'income', ?)`,
            [userId, amount, source]
        );
        
        res.redirect('/income');
    } catch (err) {
        console.error("Error inserting income:", err);
        res.redirect('/income');
    }
});

// POST route to add new expense
app.post('/expenses', isAuthenticated, async (req, res) => {
    const { amount, source, category, month, date } = req.body;
    const userId = req.session.userId;
    
    try {
        // Determine date to use:
        // Priority: explicit `date` (YYYY-MM-DD) -> `month` (YYYY-MM -> YYYY-MM-01) -> NOW()
        let dateParam = null;
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            dateParam = date;
        } else if (month && /^\d{4}-\d{2}$/.test(month)) {
            dateParam = `${month}-01`;
        }

        if (dateParam) {
            await db.query(
                `INSERT INTO transactions (userid, date, amount, type, description, category) 
                 VALUES (?, ?, ?, 'expenses', ?, ?)`,
                [userId, dateParam, amount, source, parseInt(category, 10) || 0]
            );
        } else {
            await db.query(
                `INSERT INTO transactions (userid, date, amount, type, description, category) 
                 VALUES (?, NOW(), ?, 'expenses', ?, ?)`,
                [userId, amount, source, parseInt(category, 10) || 0]
            );
        }
        
        res.redirect('/expenses');
    } catch (err) {
        console.error("Error inserting expense:", err);
        res.redirect('/expenses');
    }
});

// Expenses page (protected - requires authentication)
app.get('/expenses', isAuthenticated, async (req, res) => {
    const pageTitle = 'Expenses';
    const pageData = {
        username: req.session.username,
        transactions: [],
        currentBudget: 0,
        thisMonthIncome: 0
    };
    
    try {
        // Determine which month to show (pagination): `?page=0` = current month, `?page=1` = previous month, etc.
        const page = Math.max(0, parseInt(req.query.page, 10) || 0);
        const now = new Date();
        const target = new Date(now.getFullYear(), now.getMonth() - page, 1);
        const targetMonth = target.getMonth() + 1;
        const targetYear = target.getFullYear();
        const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        pageData.page = page;
        pageData.selectedMonthLabel = `${monthNames[target.getMonth()]} ${targetYear}`;

        // Fetch expense transactions for the selected month (include category)
        const [transactions] = await db.query(
            `SELECT date, amount, description, category, type AS actionType FROM transactions 
             WHERE userid = ? AND type = 'expenses' 
             AND MONTH(date) = ? AND YEAR(date) = ?
             ORDER BY date DESC`,
            [req.session.userId, targetMonth, targetYear]
        );

        pageData.transactions = transactions;

        // Calculate current budget (total income - total expenses overall)
        const [budgetResult] = await db.query(
            `SELECT 
                COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) as budget
             FROM transactions 
             WHERE userid = ?`,
            [req.session.userId]
        );

        pageData.currentBudget = budgetResult[0]?.budget || 0;

        // Calculate monthly expenses for the selected month
        const [monthlyExpensesResult] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as monthlyExpenses
             FROM transactions 
             WHERE userid = ? AND type = 'expenses' 
             AND MONTH(date) = ? AND YEAR(date) = ?`,
            [req.session.userId, targetMonth, targetYear]
        );

        pageData.thisMonthExpenses = monthlyExpensesResult[0]?.monthlyExpenses || 0;

        // Calculate monthly income for the selected month
        const [monthlyIncomeResult] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as monthlyIncome
             FROM transactions 
             WHERE userid = ? AND type = 'income' 
             AND MONTH(date) = ? AND YEAR(date) = ?`,
            [req.session.userId, targetMonth, targetYear]
        );

        pageData.thisMonthIncome = monthlyIncomeResult[0]?.monthlyIncome || 0;

        // Fetch totals per category for the selected month (gastos by category)
        const [byCategoryRows] = await db.query(
            `SELECT category AS categoryId, COALESCE(SUM(amount),0) AS total
             FROM transactions
             WHERE userid = ? AND type = 'expenses'
               AND MONTH(date) = ? AND YEAR(date) = ?
             GROUP BY category
             ORDER BY total DESC`,
            [req.session.userId, targetMonth, targetYear]
        );

        // Keep the array for table rendering and also build a map keyed by category id
        pageData.byCategoryList = byCategoryRows; // Array of { categoryId, total }
        const byCategoryMap = {};
        for (const r of byCategoryRows) {
            // Use string keys to be safe when accessed from EJS (data.byCategory['2'])
            byCategoryMap[String(r.categoryId)] = { totalexpense: r.total };
        }
        pageData.byCategory = byCategoryMap; // e.g. data.byCategory['2'].totalexpense

        // Calculate total monthly budget from `budget` table for selected month
        const mm = String(targetMonth).padStart(2, '0');
        const yyyy = String(targetYear);
        const budgetMMYY = `${mm}${yyyy}`; // e.g., '122025'

        const [monthlyBudgetResult] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as monthlyBudget
             FROM budget
             WHERE userId = ? AND budgetMMYY = ?`,
            [req.session.userId, budgetMMYY]
        );

        pageData.totalMonthlyBudget = monthlyBudgetResult[0]?.monthlyBudget || 0;
        
    } catch (err) {
        console.error("Error fetching transactions:", err);
    }
    
    renderPage(req, res, 'expenses', pageTitle, pageData);
});

// POST route to set/update budget for a category for the current month
app.post('/budget', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.userId;
        let { category, amount, description, month } = req.body;

        // Basic validation / sanitization
        category = parseInt(category, 10) || 0;
        amount = parseFloat(amount) || 0;
        description = description ? description.toString().slice(0, 255) : null;

        // Build budgetMMYY as MMYYYY (6 chars). If `month` provided (YYYY-MM), use it.
        let mm, yyyy;
        if (month && /^\d{4}-\d{2}$/.test(month)) {
            // month is 'YYYY-MM'
            yyyy = month.slice(0,4);
            mm = month.slice(5,7);
        } else {
            const now = new Date();
            mm = String(now.getMonth() + 1).padStart(2, '0');
            yyyy = String(now.getFullYear());
        }
        const budgetMMYY = `${mm}${yyyy}`;

        // Upsert into budget table
        await db.query(
            `INSERT INTO budget (userId, budgetMMYY, categoryId, amount, description)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE amount = VALUES(amount), description = VALUES(description)`,
            [userId, budgetMMYY, category, amount, description]
        );

        return res.redirect('/expenses');
    } catch (err) {
        console.error('Error setting budget:', err);
        return res.redirect('/expenses');
    }
});



// Logout route
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Error destroying session:", err);
            return res.status(500).send('Error logging out');
        }
        res.redirect('/login');
    });
});











// Run server
app.listen(3000, () => {
    console.log("🚀 Server running on http://localhost:3000");
});