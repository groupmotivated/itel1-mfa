require('dotenv').config();
const express = require('express');
const bodyParser = require("body-parser");
const cookieParser = require('cookie-parser');
const cookieSession = require('cookie-session');
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
// Use encrypted cookie session (stored client-side) so no DB table is required.
app.use(cookieSession({
    name: 'session',
    keys: [process.env.SESSION_SECRET || 'session-key'],
    // No maxAge -> session cookie (expires on browser close). Set to a number (ms) for persistent cookie.
    // secure: true in production when using HTTPS
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
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
// Serve Chart.js from node_modules for local use instead of CDN
app.use('/dist/chartjs', express.static(path.join(__dirname, '../node_modules/chart.js/dist')));

// Specify the directory where your EJS template files are located
app.set('views', path.join(__dirname, 'views'));

// Helper function to pass authentication data to baseof template
const renderPage = (req, res, viewName, pageTitle, pageData = {}) => {
    res.render(viewName, { title: pageTitle, data: pageData }, (err, pageContent) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error rendering page');
        }
        // Provide `activePage` to the base template so header can highlight the correct nav item.
        // Map view names to nav ids when they differ (e.g. 'index' view => 'home' nav id)
        const activePageName = (viewName === 'index') ? 'home' : viewName;
        res.render('baseof', { 
            title: pageTitle, 
            body: pageContent,
            isAuthenticated: !!req.session.userId,
            username: req.session.username,
            activePage: activePageName
        });
    });
};


// Home page route. will show summary if authenticated, 
// will show default home when not authenticated. 
app.get('/', async (req, res) => {
    const pageTitle = 'Home';
    const pageData = {
        username: req.session.username
    };

    // If authenticated, compute simple spending statistics for the dashboard
    if (req.session.userId) {
        try {
            const userId = req.session.userId;
            const now = new Date();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yyyy = String(now.getFullYear());

            // total expenses for current month
            const [monthlyExpensesResult] = await db.query(
                `SELECT COALESCE(SUM(amount), 0) as monthlyExpenses
                 FROM transactions
                 WHERE userid = ? AND type = 'expenses'
                   AND MONTH(date) = ? AND YEAR(date) = ?`,
                [userId, mm, yyyy]
            );

            pageData.monthlyExpenses = monthlyExpensesResult[0]?.monthlyExpenses || 0;

            // total budget for current month from budget table
            const budgetMMYY = `${mm}${yyyy}`;
            const [monthlyBudgetResult] = await db.query(
                `SELECT COALESCE(SUM(amount), 0) as monthlyBudget
                 FROM budget
                 WHERE userId = ? AND budgetMMYY = ?`,
                [userId, budgetMMYY]
            );

            pageData.monthlyBudget = monthlyBudgetResult[0]?.monthlyBudget || 0;

            // remaining (budget - spent)
            pageData.monthlyRemaining = (pageData.monthlyBudget - pageData.monthlyExpenses) || 0;

            // top 3 categories by spend this month
            const [topCategories] = await db.query(
                `SELECT category AS categoryId, COALESCE(SUM(amount),0) AS total
                 FROM transactions
                 WHERE userid = ? AND type = 'expenses' AND MONTH(date) = ? AND YEAR(date) = ?
                 GROUP BY category
                 ORDER BY total DESC
                 LIMIT 3`,
                [userId, mm, yyyy]
            );

            pageData.topCategories = topCategories; // array of {categoryId, total}
        } catch (err) {
            console.error('Error computing home stats:', err);
        }
    }

    renderPage(req, res, 'index', pageTitle, pageData);
});

// About page route
app.get('/about', (req, res) => {
    const pageTitle = 'About';
    const pageData = {
        username: req.session.username
    };
    renderPage(req, res, 'about', pageTitle, pageData);
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
        thisMonthIncome: 0,
        thisMonthBudget: 0
    };
    
    try {
        // Pagination by month: `?page=0` => current month, `?page=1` => previous month, etc.
        const page = Math.max(0, parseInt(req.query.page, 10) || 0);
        const now = new Date();
        const target = new Date(now.getFullYear(), now.getMonth() - page, 1);
        const targetMonth = target.getMonth() + 1;
        const targetYear = target.getFullYear();
        const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
        pageData.page = page;
        pageData.selectedMonthLabel = `${monthNames[target.getMonth()]} ${targetYear}`;

        // Fetch income transactions for the selected month
        const [transactions] = await db.query(
            `SELECT date, amount, description FROM transactions 
             WHERE userid = ? AND type = 'income' 
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

        // Calculate this month's budget from the `budget` table (sum of budgets set for the selected month)
        const mmForBudget = String(targetMonth).padStart(2, '0');
        const yyyyForBudget = String(targetYear);
        const budgetMMYYForQuery = `${mmForBudget}${yyyyForBudget}`; // e.g. '122025'

        const [monthlyBudgetResult] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as monthlyBudget
             FROM budget
             WHERE userId = ? AND budgetMMYY = ?`,
            [req.session.userId, budgetMMYYForQuery]
        );

        pageData.thisMonthBudget = monthlyBudgetResult[0]?.monthlyBudget || 0;

        // Calculate this month's income (for selected month)
        const [monthlyResult] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as monthlyIncome
             FROM transactions 
             WHERE userid = ? AND type = 'income' 
             AND MONTH(date) = ? AND YEAR(date) = ?`,
            [req.session.userId, targetMonth, targetYear]
        );
        pageData.thisMonthIncome = monthlyResult[0]?.monthlyIncome || 0;

    } catch (err) {
        console.error("Error fetching income transactions:", err);
    }
    
    renderPage(req, res, 'income', pageTitle, pageData);
});

// POST route to add new income
app.post('/income', isAuthenticated, async (req, res) => {
    const { amount, source, date } = req.body; // `date` expected as 'YYYY-MM-DD' from date input
    const userId = req.session.userId;
    
    try {
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            // Insert with provided date
            await db.query(
                `INSERT INTO transactions (userid, date, amount, type, description) 
                 VALUES (?, ?, ?, 'income', ?)`,
                [userId, date, amount, source]
            );
        } else {
            await db.query(
                `INSERT INTO transactions (userid, date, amount, type, description) 
                 VALUES (?, NOW(), ?, 'income', ?)`,
                [userId, amount, source]
            );
        }
        
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

// API: total expenses per month for a year (bar chart data)
app.get('/api/stats/expenses/yearly', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.userId;
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();

        const [rows] = await db.query(
            `SELECT MONTH(date) AS month, COALESCE(SUM(amount),0) AS total
             FROM transactions
             WHERE userid = ? AND type = 'expenses' AND YEAR(date) = ?
             GROUP BY MONTH(date)`,
            [userId, year]
        );

        // Build an array of 12 months
        const totals = Array.from({ length: 12 }, () => 0);
        for (const r of rows) {
            const idx = parseInt(r.month, 10) - 1;
            if (idx >= 0 && idx < 12) totals[idx] = Number(r.total) || 0;
        }

        res.json({ year, totals });
    } catch (err) {
        console.error('Error /api/stats/expenses/yearly', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: total income (salary) per month for a year (bar chart data)
app.get('/api/stats/income/yearly', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.userId;
        const year = parseInt(req.query.year, 10) || new Date().getFullYear();

        const [rows] = await db.query(
            `SELECT MONTH(date) AS month, COALESCE(SUM(amount),0) AS total
             FROM transactions
             WHERE userid = ? AND type = 'income' AND YEAR(date) = ?
             GROUP BY MONTH(date)`,
            [userId, year]
        );

        const totals = Array.from({ length: 12 }, () => 0);
        for (const r of rows) {
            const idx = parseInt(r.month, 10) - 1;
            if (idx >= 0 && idx < 12) totals[idx] = Number(r.total) || 0;
        }

        res.json({ year, totals });
    } catch (err) {
        console.error('Error /api/stats/income/yearly', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// API: expenses per category for a given month (pie chart data). month param: 'YYYY-MM'
app.get('/api/stats/expenses/category', isAuthenticated, async (req, res) => {
    try {
        const userId = req.session.userId;
        let monthParam = req.query.month; // optional 'YYYY-MM'
        let target = new Date();
        if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
            const [y, m] = monthParam.split('-').map(Number);
            target = new Date(y, m - 1, 1);
        }
        const mm = target.getMonth() + 1;
        const yyyy = target.getFullYear();

        const [rows] = await db.query(
            `SELECT category AS categoryId, COALESCE(SUM(amount),0) AS total
             FROM transactions
             WHERE userid = ? AND type = 'expenses' AND MONTH(date) = ? AND YEAR(date) = ?
             GROUP BY category
             ORDER BY total DESC`,
            [userId, mm, yyyy]
        );

        // Map category ids to friendly labels (same mapping as views)
        const categoryNames = {
            1: 'Groceries and Needs',
            2: 'Bills and Obligations',
            3: 'Entertainment and Leisure'
        };

        const labels = [];
        const totals = [];
        for (const r of rows) {
            const id = String(r.categoryId);
            labels.push(categoryNames[id] || 'Others');
            totals.push(Number(r.total) || 0);
        }

        res.json({ month: `${String(mm).padStart(2,'0')}-${yyyy}`, labels, totals });
    } catch (err) {
        console.error('Error /api/stats/expenses/category', err);
        res.status(500).json({ error: 'Server error' });
    }
});











// Run server
app.listen(3000, () => {
    console.log("🚀 Server running on http://localhost:3000");
});