const express = require('express');
const bodyParser = require("body-parser");
const mysql = require("mysql2");
let ejs = require('ejs');
const path = require('path');

/* Keep it for future purposes
const msgdb = mysql.createConnection({
host: "localhost",
user: "root", // change if needed
password: "passwd", // add your MySQL password
database: "msgdb" // create this DB in MySQL
}).promise();

*/

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


// Specify the directory where your EJS template files are located
app.set('views', path.join(__dirname, 'views'));


// Define a route to render an EJS view
app.get('/', (req, res) => {
    const pageTitle = 'My EJS Page';
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







// Run server
app.listen(3000, () => {
    console.log("🚀 Server running on http://localhost:3000");
});