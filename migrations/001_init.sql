CREATE TABLE english_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    UNIQUE(type, text)
);

CREATE INDEX idx_english_items_type ON english_items(type);
CREATE INDEX idx_english_items_text ON english_items(text);