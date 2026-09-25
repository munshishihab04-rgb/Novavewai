ALTER TABLE sources ALTER COLUMN message_id DROP NOT NULL;
ALTER TABLE sources ADD COLUMN file_id uuid;
ALTER TABLE sources ADD CONSTRAINT source_origin CHECK((message_id IS NOT NULL)::int+(file_id IS NOT NULL)::int=1);
ALTER TABLE sources ADD CONSTRAINT source_file FOREIGN KEY(owner_id,conversation_id,file_id) REFERENCES files(owner_id,conversation_id,id) ON DELETE CASCADE;
