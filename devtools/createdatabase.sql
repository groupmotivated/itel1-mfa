CREATE DATABASE mfaapp;
USE mfaapp;
CREATE TABLE user (
    uid INT NOT NULL PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(500) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(100) NOT NULL
);

CREATE TABLE transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    userid INT NOT NULL,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    amount DECIMAL(10, 2) NOT NULL,
    type VARCHAR(20) NOT NULL,
    description VARCHAR(255),
    categoryId INT,
    FOREIGN KEY (userid) REFERENCES user(uid),
    INDEX (userid, type),
    INDEX (date)
);