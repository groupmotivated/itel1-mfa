require('dotenv').config();
const express = require('express');
const bodyParser = require("body-parser");
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
// Set EJS as the view engine
app.set('view engine', 'ejs');


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


// Define a route to render an EJS view
app.get('/', (req, res) => {
    const pageTitle = 'Home';
    const data = {
        name: 'John Doe',
        items: ['Apple', 'Banana', 'Orange']
    };
    
    // First render the page content
    res.render('index', { title: pageTitle, user: data }, (err, pageContent) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error rendering page');
        }
        
        // Then render the layout with the page content
        res.render('baseof', { 
            title: pageTitle, 
            body: pageContent 
        });
    });
});


// Routes to render /register page
app.get('/register', (req, res) => {
    const pageTitle = 'Register';
    const pageData = {
        errorMessage: null,
        successMessage: null
    }
    // First render the page content
    res.render('register', { title: pageTitle, data: pageData}, (err, pageContent) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error rendering page');
        }
        
        // Then render the layout with the page content
        res.render('baseof', { 
            title: pageTitle, 
            body: pageContent 
        });
    });
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

        pageData.successMessage = "User registered successfully!";

        return res.render('register', { title: pageTitle, data: pageData }, (err, pageContent) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error rendering page');
            }
            res.render('baseof', { 
                title: pageTitle, 
                body: pageContent 
            });
        });

    } catch (err) {
        console.error("Database error:", err);

        if (err.code === "ER_DUP_ENTRY") {
            pageData.errorMessage = "Username or email is already registered!";
            return res.render('register', { title: pageTitle, data: pageData }, (err, pageContent) => {
                if (err) {
                    console.error(err);
                    return res.status(500).send('Error rendering page');
                }
                res.render('baseof', { 
                    title: pageTitle, 
                    body: pageContent 
                });
            });
        }

        pageData.errorMessage = "Database error!";
        return res.render('register', { title: pageTitle, data: pageData }, (err, pageContent) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error rendering page');
            }
            res.render('baseof', { 
                title: pageTitle, 
                body: pageContent 
            });
        });
    }
});











// Run server
app.listen(3000, () => {
    console.log("🚀 Server running on http://localhost:3000");
});