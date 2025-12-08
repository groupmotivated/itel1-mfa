DROP DATABASE IF EXISTS `mfaapp`;
CREATE DATABASE `mfaapp`;
USE `mfaapp`;

DROP TABLE IF EXISTS `user`;
CREATE TABLE `user` (
  `uid` INT NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(64) NOT NULL,
  `name` VARCHAR(500) NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `password` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`uid`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TABLE IF EXISTS `budget`;
CREATE TABLE `budget` (
  `userId` INT NOT NULL,
  `budgetMMYY` VARCHAR(6) NOT NULL,
  `categoryId` INT NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (`userId`, `budgetMMYY`, `categoryId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


DROP TABLE IF EXISTS `transactions`;
CREATE TABLE `transactions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `userid` INT NOT NULL,
  `date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `amount` DECIMAL(10,2) NOT NULL,
  `type` VARCHAR(20) NOT NULL,
  `description` VARCHAR(255) DEFAULT NULL,
  `category` INT DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `userid` (`userid`,`type`),
  KEY `date` (`date`),
  CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`userid`) REFERENCES `user` (`uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- End of script
