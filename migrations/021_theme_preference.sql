-- Appearance preference: 'system' follows the device (prefers-color-scheme), 'light'/'dark' pin a theme on every device.
ALTER TABLE user_preferences ADD COLUMN theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system','light','dark'));
