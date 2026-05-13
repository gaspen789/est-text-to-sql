-- Seed a default Estonian language entry required by the app_user FK
INSERT INTO public.language (language_code, name, is_active)
VALUES ('EST', 'Eesti', true);

-- Seed a default admin account (password: admin1234)
-- The creator trigger is bypassed here because this is the bootstrap user.
ALTER TABLE public.app_user DISABLE TRIGGER tr_app_user_automatic_insert_creator;

WITH new_user AS (
    INSERT INTO public.app_user (email, is_active, preferred_llm_language, created_at_time, modified_at_time)
    VALUES ('admin@example.com', true, 'EST', now(), now())
    RETURNING app_user_id
),
new_account AS (
    INSERT INTO public.account (app_user_id, password_hash, created_at_time, modified_at_time)
    SELECT app_user_id,
           extensions.crypt('admin1234', extensions.gen_salt('bf', 12)),
           now(), now()
    FROM new_user
)
INSERT INTO public.app_user_role_assignment (app_user_id, user_role_code)
SELECT app_user_id, 'ADM'
FROM new_user;

ALTER TABLE public.app_user ENABLE TRIGGER tr_app_user_automatic_insert_creator;
