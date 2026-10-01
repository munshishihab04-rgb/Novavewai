ALTER TABLE files DROP CONSTRAINT files_mime_check;
ALTER TABLE files DROP CONSTRAINT files_size_check;
ALTER TABLE files ADD CONSTRAINT files_size_check CHECK(size BETWEEN 1 AND 4194304);
ALTER TABLE files ADD CONSTRAINT files_mime_check CHECK(length(mime) BETWEEN 1 AND 100);
ALTER TABLE files ADD COLUMN extraction jsonb NOT NULL DEFAULT '{"status":"extracted","method":"utf8","executed":false}'::jsonb;
