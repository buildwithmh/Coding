CREATE TABLE IF NOT EXISTS notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(100) NOT NULL
);

INSERT INTO notes (title) VALUES ('Hello from MhCoder');

SELECT * FROM notes;
