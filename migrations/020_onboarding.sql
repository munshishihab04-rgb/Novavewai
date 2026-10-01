-- First-visit onboarding (language choice + info cards) shown once per account; stored server-side so it follows the user across devices.
ALTER TABLE user_preferences ADD COLUMN onboarded boolean NOT NULL DEFAULT false;
