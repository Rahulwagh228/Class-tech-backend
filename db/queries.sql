-- =============================================================================
-- Class Tech - Auth queries (PostgreSQL, parameterised with $1, $2, ...)
-- =============================================================================
-- These map 1:1 to methods on IUserRepository in
-- src/repositories/userRepository.ts.  Use them with `pg`, `postgres`, or
-- whichever driver you wire up.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. SIGNUP / CREATE USER
--    Used by: AuthService.signup()
--    Repo method: userRepository.create()
-- -----------------------------------------------------------------------------
-- params:
--   $1 name
--   $2 username
--   $3 email
--   $4 password_hash       (bcrypt)
--   $5 profile_photo       (nullable)
--   $6 role                ('admin' | 'student' | 'parent')
--   $7 email_verification_token
--   $8 email_verification_expires_at  (timestamptz, NOW() + INTERVAL '24 hours')
INSERT INTO users (
  name, username, email, password_hash, profile_photo, role,
  email_verification_token, email_verification_expires_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING
  id, name, username, email, profile_photo, role,
  email_verified, created_at, updated_at;


-- -----------------------------------------------------------------------------
-- 2. LOGIN - lookup by email OR username
--    Used by: AuthService.login()
--    Returns password_hash so the service can bcrypt.compare().
-- -----------------------------------------------------------------------------
-- params:
--   $1 email_or_username
SELECT
  id, name, username, email, password_hash, profile_photo, role,
  email_verified, email_verification_token, email_verification_expires_at,
  created_at, updated_at
FROM users
WHERE email = $1 OR username = $1
LIMIT 1;


-- -----------------------------------------------------------------------------
-- 3. FIND BY ID
--    Used by: GET /api/v1/auth/me  (after JWT verify)
--    Repo method: userRepository.findById()
-- -----------------------------------------------------------------------------
-- params:
--   $1 user_id (UUID)
SELECT
  id, name, username, email, profile_photo, role,
  email_verified, created_at, updated_at
FROM users
WHERE id = $1;


-- -----------------------------------------------------------------------------
-- 4. FIND BY EMAIL  (uniqueness pre-check + resend-verification lookup)
--    Repo method: userRepository.findByEmail()
-- -----------------------------------------------------------------------------
-- params:
--   $1 email
SELECT
  id, name, username, email, password_hash, profile_photo, role,
  email_verified, email_verification_token, email_verification_expires_at,
  created_at, updated_at
FROM users
WHERE email = $1;


-- -----------------------------------------------------------------------------
-- 5. FIND BY USERNAME  (uniqueness pre-check)
--    Repo method: userRepository.findByUsername()
-- -----------------------------------------------------------------------------
-- params:
--   $1 username
SELECT
  id, name, username, email, profile_photo, role,
  email_verified, created_at, updated_at
FROM users
WHERE username = $1;


-- -----------------------------------------------------------------------------
-- 6. FIND BY VERIFICATION TOKEN
--    Used by: GET /api/v1/auth/verify-email
--    Repo method: userRepository.findByVerificationToken()
-- -----------------------------------------------------------------------------
-- params:
--   $1 token
SELECT
  id, name, username, email, profile_photo, role,
  email_verified, email_verification_token, email_verification_expires_at,
  created_at, updated_at
FROM users
WHERE email_verification_token = $1;


-- -----------------------------------------------------------------------------
-- 7. MARK EMAIL VERIFIED
--    Used by: AuthService.verifyEmail()  (atomic, single round-trip)
--    Repo method: userRepository.markEmailVerified()
-- -----------------------------------------------------------------------------
-- params:
--   $1 token   (use the token, not the id, so it's idempotent + race-safe)
UPDATE users
SET
  email_verified                = TRUE,
  email_verification_token      = NULL,
  email_verification_expires_at = NULL
WHERE email_verification_token = $1
  AND email_verification_expires_at > NOW()
RETURNING
  id, name, username, email, profile_photo, role,
  email_verified, created_at, updated_at;
-- If 0 rows returned -> token invalid OR expired.


-- -----------------------------------------------------------------------------
-- 8. UPDATE VERIFICATION TOKEN  (resend-verification)
--    Used by: AuthService.resendVerification()
--    Repo method: userRepository.updateVerificationToken()
--    Only updates if the user is NOT already verified (cheap guard).
-- -----------------------------------------------------------------------------
-- params:
--   $1 user_id
--   $2 new_token
--   $3 new_expires_at
UPDATE users
SET
  email_verification_token      = $2,
  email_verification_expires_at = $3
WHERE id = $1
  AND email_verified = FALSE
RETURNING id, email, name;


-- =============================================================================
-- Optional admin / role-management queries
-- =============================================================================

-- 9. List users by role (paginated)
-- params: $1 role, $2 limit, $3 offset
SELECT
  id, name, username, email, profile_photo, role,
  email_verified, created_at
FROM users
WHERE role = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;


-- 10. Count users by role
SELECT role, COUNT(*) AS total
FROM users
GROUP BY role;


-- 11. Promote / change a user's role (admin only)
-- params: $1 user_id, $2 new_role
UPDATE users
SET role = $2
WHERE id = $1
RETURNING id, username, email, role;


-- 12. Soft delete pattern (if you add deleted_at later)
-- ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ;
-- UPDATE users SET deleted_at = NOW() WHERE id = $1;
