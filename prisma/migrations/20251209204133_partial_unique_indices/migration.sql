CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email_lower_unique
ON "User"(LOWER("email"))
WHERE "email" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_phone_unique
ON "User"("phoneNumber")
WHERE "phoneNumber" IS NOT NULL;