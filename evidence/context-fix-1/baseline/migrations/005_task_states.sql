ALTER TABLE tasks ADD CONSTRAINT task_status CHECK(status IN ('created','active','paused','completed','cancelled'));
ALTER TABLE tasks ADD CONSTRAINT task_version CHECK(version>0);
