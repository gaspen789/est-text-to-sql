SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE DATABASE andmejutt WITH TEMPLATE = template0 ENCODING = 'UTF8' LOCALE_PROVIDER = libc LOCALE = 'et_EE.UTF-8';

ALTER DATABASE andmejutt OWNER TO app_superuser;

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

CREATE SCHEMA extensions;

ALTER SCHEMA extensions OWNER TO app_superuser;

CREATE SCHEMA external;

ALTER SCHEMA external OWNER TO app_superuser;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';

CREATE EXTENSION IF NOT EXISTS postgres_fdw WITH SCHEMA extensions;

COMMENT ON EXTENSION postgres_fdw IS 'foreign-data wrapper for remote PostgreSQL servers';

CREATE DOMAIN public.d_bcrypt_hash AS character varying(300)
	CONSTRAINT d_bcrypt_hash_check CHECK (((VALUE)::text ~ '^\$2[aby]\$\d{2}\$[./[:alnum:]]{53}$'::text));

ALTER DOMAIN public.d_bcrypt_hash OWNER TO app_superuser;

COMMENT ON DOMAIN public.d_bcrypt_hash IS 'bcrypt hash in modular crypt format.';

CREATE DOMAIN public.d_email_ci AS character varying(254)
	CONSTRAINT d_email_ci_check CHECK (((VALUE)::text ~~ '%@%'::text));

ALTER DOMAIN public.d_email_ci OWNER TO app_superuser;

COMMENT ON DOMAIN public.d_email_ci IS 'Email-like value with a minimal validity rule. Intended for case-insensitive uniqueness via functional index.';

CREATE DOMAIN public.d_https_url AS character varying(500)
	CONSTRAINT d_https_url_check CHECK (((VALUE)::text ~ '^https://.+'::text));

ALTER DOMAIN public.d_https_url OWNER TO app_superuser;

COMMENT ON DOMAIN public.d_https_url IS 'Value that starts with https.';

CREATE DOMAIN public.d_nonnegative_int AS integer
	CONSTRAINT d_nonnegative_int_check CHECK ((VALUE >= 0));

ALTER DOMAIN public.d_nonnegative_int OWNER TO app_superuser;

COMMENT ON DOMAIN public.d_nonnegative_int IS 'Integer greater than or equal to 0.';

CREATE DOMAIN public.d_positive_int AS integer
	CONSTRAINT d_positive_int_check CHECK ((VALUE > 0));

ALTER DOMAIN public.d_positive_int OWNER TO app_superuser;

COMMENT ON DOMAIN public.d_positive_int IS 'Integer greater than 0.';

CREATE DOMAIN public.d_start_created_modified_at_time AS timestamp(0) with time zone DEFAULT date_trunc('second'::text, CURRENT_TIMESTAMP)
	CONSTRAINT chk_start_created_modified_at_time CHECK (((VALUE >= '2025-01-01 00:00:00+02'::timestamp with time zone) AND (VALUE < '2101-01-01 00:00:00+02'::timestamp with time zone)));

ALTER DOMAIN public.d_start_created_modified_at_time OWNER TO app_superuser;

COMMENT ON DOMAIN public.d_start_created_modified_at_time IS 'Timestamp with timezone between 01.01.2025 and 01.01.2101.';

CREATE FUNCTION public.account_hash_password_hash() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
BEGIN
  IF NEW.password_hash IS NULL OR NEW.password_hash = '' THEN
    RETURN NEW;
  END IF;

  -- If the backend already provided a bcrypt hash, do not hash again.
  IF NEW.password_hash ~ '^\$2[aby]\$\d{2}\$[./[:alnum:]]{53}$' THEN
    RETURN NEW;
  END IF;

  NEW.password_hash := extensions.crypt(NEW.password_hash, extensions.gen_salt('bf', 12));
  RETURN NEW;
END;
$_$;

ALTER FUNCTION public.account_hash_password_hash() OWNER TO app_superuser;

SET default_tablespace = '';

SET default_table_access_method = heap;

CREATE TABLE public.app_user_role_assignment (
    user_role_code character(3) NOT NULL,
    app_user_id bigint NOT NULL
)
WITH (fillfactor='90');

ALTER TABLE public.app_user_role_assignment OWNER TO app_superuser;

CREATE TABLE public.llm (
    llm_id bigint NOT NULL,
    creator bigint NOT NULL,
    modifier bigint NOT NULL,
    llm_group_id integer NOT NULL,
    model_name character varying(200) NOT NULL,
    version character varying(50),
    context_length public.d_positive_int NOT NULL,
    max_output_tokens public.d_positive_int,
    other_parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    release_date date,
    is_local boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at_time public.d_start_created_modified_at_time NOT NULL,
    modified_at_time public.d_start_created_modified_at_time NOT NULL,
    CONSTRAINT chk_llm_created_at_time_before_modified CHECK (((created_at_time)::timestamp with time zone <= (modified_at_time)::timestamp with time zone)),
    CONSTRAINT chk_llm_model_name CHECK (((model_name)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_llm_release_date_allowed_range CHECK (((release_date >= '2010-01-01'::date) AND (release_date <= '2100-12-31'::date))),
    CONSTRAINT chk_llm_version CHECK (((version)::text ~ '^(?=.*[[:alnum:]])[[:alnum:][:punct:][:space:]]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.llm OWNER TO app_superuser;

CREATE FUNCTION public.f_activate_llm(p_llm_id bigint) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 UPDATE public.llm SET is_active = true, modifier = (current_setting('myapp.current_user_id'::text))::bigint, modified_at_time = date_trunc('second'::text, CURRENT_TIMESTAMP)
   WHERE ((llm.llm_id = f_activate_llm.p_llm_id) AND (llm.is_active = false) AND (EXISTS ( SELECT 1
            FROM public.app_user_role_assignment
           WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
          FOR SHARE OF app_user_role_assignment)))
   RETURNING llm.llm_id;
END;

ALTER FUNCTION public.f_activate_llm(p_llm_id bigint) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_activate_llm(p_llm_id bigint) IS 'This function sets the specified language model to active status TRUE, making it available for use in chats.';

CREATE TABLE public.llm_group (
    llm_group_id integer NOT NULL,
    company_code character(10) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_llm_group_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_llm_group_name CHECK (((name)::text ~ '^(?=.*[[:alnum:]])[[:alnum:] ]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.llm_group OWNER TO app_superuser;

CREATE FUNCTION public.f_add_llm(p_model_name character varying, p_llm_group_id integer, p_version character varying, p_context_length public.d_positive_int, p_max_output_tokens public.d_positive_int, p_other_parameters jsonb, p_release_date date, p_is_local boolean, p_is_active boolean) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 INSERT INTO public.llm (model_name, llm_group_id, version, context_length, max_output_tokens, other_parameters, release_date, is_local, is_active, creator, modifier)  SELECT f_add_llm.p_model_name AS p_model_name,
             f_add_llm.p_llm_group_id AS p_llm_group_id,
             f_add_llm.p_version AS p_version,
             f_add_llm.p_context_length AS p_context_length,
             f_add_llm.p_max_output_tokens AS p_max_output_tokens,
             f_add_llm.p_other_parameters AS p_other_parameters,
             f_add_llm.p_release_date AS p_release_date,
             f_add_llm.p_is_local AS p_is_local,
             f_add_llm.p_is_active AS p_is_active,
             (current_setting('myapp.current_user_id'::text))::bigint AS current_setting,
             (current_setting('myapp.current_user_id'::text))::bigint AS current_setting
           WHERE ((EXISTS ( SELECT 1
                    FROM public.app_user_role_assignment
                   WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                  FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                    FROM public.llm_group
                   WHERE ((llm_group.llm_group_id = f_add_llm.p_llm_group_id) AND (llm_group.is_active = true))
                  FOR SHARE OF llm_group)))
   RETURNING llm.llm_id;
END;

ALTER FUNCTION public.f_add_llm(p_model_name character varying, p_llm_group_id integer, p_version character varying, p_context_length public.d_positive_int, p_max_output_tokens public.d_positive_int, p_other_parameters jsonb, p_release_date date, p_is_local boolean, p_is_active boolean) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_add_llm(p_model_name character varying, p_llm_group_id integer, p_version character varying, p_context_length public.d_positive_int, p_max_output_tokens public.d_positive_int, p_other_parameters jsonb, p_release_date date, p_is_local boolean, p_is_active boolean) IS 'This function inserts a new language model into the LLM table together with its specifications. It checks that the caller has administrator privileges and that the target LLM group exists and is active.';

CREATE TABLE public.llm_api (
    llm_api_id bigint NOT NULL,
    llm_id bigint NOT NULL,
    encrypted_api_key text CONSTRAINT llm_api_api_key_not_null NOT NULL,
    encrypted_request_url text,
    is_active boolean DEFAULT true NOT NULL,
    token_limit_per_minute public.d_positive_int,
    request_limit_per_minute public.d_positive_int,
    request_limit_per_day public.d_positive_int,
    CONSTRAINT chk_llm_api_api_key CHECK ((encrypted_api_key ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:]]+$'::text)),
    CONSTRAINT chk_llm_api_request_url_contains_https CHECK ((encrypted_request_url ~ '^https://.+'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.llm_api OWNER TO app_superuser;

CREATE FUNCTION public.f_add_llm_api(p_llm_id bigint, p_encrypted_api_key text, p_encrypted_request_url text, p_is_active boolean, p_token_limit_per_minute public.d_positive_int, p_request_limit_per_minute public.d_positive_int, p_request_limit_per_day public.d_positive_int) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 INSERT INTO public.llm_api (llm_id, encrypted_api_key, encrypted_request_url, is_active, token_limit_per_minute, request_limit_per_minute, request_limit_per_day)  SELECT f_add_llm_api.p_llm_id AS p_llm_id,
             f_add_llm_api.p_encrypted_api_key AS p_encrypted_api_key,
             f_add_llm_api.p_encrypted_request_url AS p_encrypted_request_url,
             f_add_llm_api.p_is_active AS p_is_active,
             f_add_llm_api.p_token_limit_per_minute AS p_token_limit_per_minute,
             f_add_llm_api.p_request_limit_per_minute AS p_request_limit_per_minute,
             f_add_llm_api.p_request_limit_per_day AS p_request_limit_per_day
           WHERE (EXISTS ( SELECT 1
                    FROM public.app_user_role_assignment
                   WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                  FOR SHARE OF app_user_role_assignment))
   RETURNING llm_api.llm_api_id;
END;

ALTER FUNCTION public.f_add_llm_api(p_llm_id bigint, p_encrypted_api_key text, p_encrypted_request_url text, p_is_active boolean, p_token_limit_per_minute public.d_positive_int, p_request_limit_per_minute public.d_positive_int, p_request_limit_per_day public.d_positive_int) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_add_llm_api(p_llm_id bigint, p_encrypted_api_key text, p_encrypted_request_url text, p_is_active boolean, p_token_limit_per_minute public.d_positive_int, p_request_limit_per_minute public.d_positive_int, p_request_limit_per_day public.d_positive_int) IS 'This function inserts new API data for a large language model with active status.';

CREATE TABLE public.currency (
    currency_code character(3) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_currency_currency_code CHECK ((currency_code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT chk_currency_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_currency_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:] ]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.currency OWNER TO app_superuser;

CREATE TABLE public.llm_price (
    llm_price_id bigint NOT NULL,
    currency_code character(3) DEFAULT 'USD'::bpchar NOT NULL,
    llm_id bigint NOT NULL,
    unit_type_code character(3) DEFAULT 'TOK'::bpchar NOT NULL,
    price_per_unit numeric(18,10) NOT NULL,
    unit_size public.d_positive_int,
    min_unit_size public.d_positive_int,
    max_unit_size public.d_positive_int,
    is_batch boolean DEFAULT false NOT NULL,
    is_input boolean DEFAULT true NOT NULL,
    valid_from_time public.d_start_created_modified_at_time NOT NULL,
    valid_until_time timestamp(0) with time zone DEFAULT 'infinity'::timestamp with time zone NOT NULL,
    CONSTRAINT chk_llm_price_min_must_be_less_max_unit_size CHECK (((min_unit_size)::integer <= (max_unit_size)::integer)),
    CONSTRAINT chk_llm_price_positive_number CHECK ((price_per_unit > (0)::numeric)),
    CONSTRAINT chk_llm_price_unit_size_and_min_max_unit_size CHECK ((((unit_size IS NULL) AND ((min_unit_size IS NOT NULL) AND (max_unit_size IS NOT NULL))) OR ((unit_size IS NOT NULL) AND ((min_unit_size IS NULL) AND (max_unit_size IS NULL))))),
    CONSTRAINT chk_llm_price_valid_from_time_before_valid_until CHECK (((valid_from_time)::timestamp with time zone <= valid_until_time)),
    CONSTRAINT chk_llm_price_valid_until_time CHECK ((valid_until_time >= '2025-01-01 00:00:00+02'::timestamp with time zone))
)
WITH (fillfactor='90');

ALTER TABLE public.llm_price OWNER TO app_superuser;

CREATE TABLE public.llm_price_modality (
    llm_supported_modality_id bigint NOT NULL,
    llm_price_id bigint NOT NULL
);

ALTER TABLE public.llm_price_modality OWNER TO app_superuser;

CREATE TABLE public.llm_supported_modality (
    llm_supported_modality_id bigint NOT NULL,
    modality_code character(1) NOT NULL,
    llm_id bigint NOT NULL,
    is_input boolean DEFAULT true NOT NULL
)
WITH (fillfactor='90');

ALTER TABLE public.llm_supported_modality OWNER TO app_superuser;

CREATE FUNCTION public.f_add_llm_price_end_time_exists(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_until_time timestamp with time zone) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 WITH inserted_price AS (
          INSERT INTO public.llm_price (llm_id, currency_code, unit_type_code, price_per_unit, unit_size, min_unit_size, max_unit_size, is_batch, is_input, valid_until_time)  SELECT f_add_llm_price_end_time_exists.p_llm_id AS p_llm_id,
                     f_add_llm_price_end_time_exists.p_currency_code AS p_currency_code,
                     f_add_llm_price_end_time_exists.p_unit_type_code AS p_unit_type_code,
                     f_add_llm_price_end_time_exists.p_price_per_unit AS p_price_per_unit,
                     f_add_llm_price_end_time_exists.p_unit_size AS p_unit_size,
                     f_add_llm_price_end_time_exists.p_min_unit_size AS p_min_unit_size,
                     f_add_llm_price_end_time_exists.p_max_unit_size AS p_max_unit_size,
                     f_add_llm_price_end_time_exists.p_is_batch AS p_is_batch,
                     sm.is_input,
                     f_add_llm_price_end_time_exists.p_valid_until_time AS p_valid_until_time
                    FROM public.llm_supported_modality sm
                   WHERE ((sm.llm_supported_modality_id = f_add_llm_price_end_time_exists.p_llm_supported_modality_id) AND (sm.llm_id = f_add_llm_price_end_time_exists.p_llm_id) AND (EXISTS ( SELECT 1
                            FROM public.app_user_role_assignment
                           WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                          FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                            FROM public.currency
                           WHERE ((currency.currency_code = f_add_llm_price_end_time_exists.p_currency_code) AND (currency.is_active = true))
                          FOR SHARE OF currency)) AND (EXISTS ( SELECT 1
                            FROM public.llm
                           WHERE (llm.llm_id = f_add_llm_price_end_time_exists.p_llm_id)
                          FOR SHARE OF llm)))
           RETURNING llm_price.llm_price_id
         )
  INSERT INTO public.llm_price_modality (llm_supported_modality_id, llm_price_id)  SELECT f_add_llm_price_end_time_exists.p_llm_supported_modality_id AS p_llm_supported_modality_id,
             inserted_price.llm_price_id
            FROM inserted_price
   RETURNING llm_price_modality.llm_price_id;
END;

ALTER FUNCTION public.f_add_llm_price_end_time_exists(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_until_time timestamp with time zone) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_add_llm_price_end_time_exists(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_until_time timestamp with time zone) IS 'This function inserts new LLM price data with a validity end time but without an explicitly provided start time.';

CREATE FUNCTION public.f_add_llm_price_start_time_exists(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_from_time public.d_start_created_modified_at_time) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 WITH inserted_price AS (
          INSERT INTO public.llm_price (llm_id, currency_code, unit_type_code, price_per_unit, unit_size, min_unit_size, max_unit_size, is_batch, is_input, valid_from_time)  SELECT f_add_llm_price_start_time_exists.p_llm_id AS p_llm_id,
                     f_add_llm_price_start_time_exists.p_currency_code AS p_currency_code,
                     f_add_llm_price_start_time_exists.p_unit_type_code AS p_unit_type_code,
                     f_add_llm_price_start_time_exists.p_price_per_unit AS p_price_per_unit,
                     f_add_llm_price_start_time_exists.p_unit_size AS p_unit_size,
                     f_add_llm_price_start_time_exists.p_min_unit_size AS p_min_unit_size,
                     f_add_llm_price_start_time_exists.p_max_unit_size AS p_max_unit_size,
                     f_add_llm_price_start_time_exists.p_is_batch AS p_is_batch,
                     sm.is_input,
                     f_add_llm_price_start_time_exists.p_valid_from_time AS p_valid_from_time
                    FROM public.llm_supported_modality sm
                   WHERE ((sm.llm_supported_modality_id = f_add_llm_price_start_time_exists.p_llm_supported_modality_id) AND (sm.llm_id = f_add_llm_price_start_time_exists.p_llm_id) AND (EXISTS ( SELECT 1
                            FROM public.app_user_role_assignment
                           WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                          FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                            FROM public.currency
                           WHERE ((currency.currency_code = f_add_llm_price_start_time_exists.p_currency_code) AND (currency.is_active = true))
                          FOR SHARE OF currency)) AND (EXISTS ( SELECT 1
                            FROM public.llm
                           WHERE (llm.llm_id = f_add_llm_price_start_time_exists.p_llm_id)
                          FOR SHARE OF llm)))
           RETURNING llm_price.llm_price_id
         )
  INSERT INTO public.llm_price_modality (llm_supported_modality_id, llm_price_id)  SELECT f_add_llm_price_start_time_exists.p_llm_supported_modality_id AS p_llm_supported_modality_id,
             inserted_price.llm_price_id
            FROM inserted_price
   RETURNING llm_price_modality.llm_price_id;
END;

ALTER FUNCTION public.f_add_llm_price_start_time_exists(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_from_time public.d_start_created_modified_at_time) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_add_llm_price_start_time_exists(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_from_time public.d_start_created_modified_at_time) IS 'This function inserts new LLM price data with a validity start time but without an explicitly provided end time.';

CREATE FUNCTION public.f_add_llm_price_time_exists(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_from_time public.d_start_created_modified_at_time, p_valid_until_time timestamp with time zone) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 WITH inserted_price AS (
          INSERT INTO public.llm_price (llm_id, currency_code, unit_type_code, price_per_unit, unit_size, min_unit_size, max_unit_size, is_batch, is_input, valid_from_time, valid_until_time)  SELECT f_add_llm_price_time_exists.p_llm_id AS p_llm_id,
                     f_add_llm_price_time_exists.p_currency_code AS p_currency_code,
                     f_add_llm_price_time_exists.p_unit_type_code AS p_unit_type_code,
                     f_add_llm_price_time_exists.p_price_per_unit AS p_price_per_unit,
                     f_add_llm_price_time_exists.p_unit_size AS p_unit_size,
                     f_add_llm_price_time_exists.p_min_unit_size AS p_min_unit_size,
                     f_add_llm_price_time_exists.p_max_unit_size AS p_max_unit_size,
                     f_add_llm_price_time_exists.p_is_batch AS p_is_batch,
                     sm.is_input,
                     f_add_llm_price_time_exists.p_valid_from_time AS p_valid_from_time,
                     f_add_llm_price_time_exists.p_valid_until_time AS p_valid_until_time
                    FROM public.llm_supported_modality sm
                   WHERE ((sm.llm_supported_modality_id = f_add_llm_price_time_exists.p_llm_supported_modality_id) AND (sm.llm_id = f_add_llm_price_time_exists.p_llm_id) AND (EXISTS ( SELECT 1
                            FROM public.app_user_role_assignment
                           WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                          FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                            FROM public.currency
                           WHERE ((currency.currency_code = f_add_llm_price_time_exists.p_currency_code) AND (currency.is_active = true))
                          FOR SHARE OF currency)) AND (EXISTS ( SELECT 1
                            FROM public.llm
                           WHERE (llm.llm_id = f_add_llm_price_time_exists.p_llm_id)
                          FOR SHARE OF llm)))
           RETURNING llm_price.llm_price_id
         )
  INSERT INTO public.llm_price_modality (llm_supported_modality_id, llm_price_id)  SELECT f_add_llm_price_time_exists.p_llm_supported_modality_id AS p_llm_supported_modality_id,
             inserted_price.llm_price_id
            FROM inserted_price
   RETURNING llm_price_modality.llm_price_id;
END;

ALTER FUNCTION public.f_add_llm_price_time_exists(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_from_time public.d_start_created_modified_at_time, p_valid_until_time timestamp with time zone) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_add_llm_price_time_exists(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_from_time public.d_start_created_modified_at_time, p_valid_until_time timestamp with time zone) IS 'This function inserts new LLM price data and stores both validity start and end times.';

CREATE FUNCTION public.f_add_llm_price_time_missing(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 WITH inserted_price AS (
          INSERT INTO public.llm_price (llm_id, currency_code, unit_type_code, price_per_unit, unit_size, min_unit_size, max_unit_size, is_batch, is_input)  SELECT f_add_llm_price_time_missing.p_llm_id AS p_llm_id,
                     f_add_llm_price_time_missing.p_currency_code AS p_currency_code,
                     f_add_llm_price_time_missing.p_unit_type_code AS p_unit_type_code,
                     f_add_llm_price_time_missing.p_price_per_unit AS p_price_per_unit,
                     f_add_llm_price_time_missing.p_unit_size AS p_unit_size,
                     f_add_llm_price_time_missing.p_min_unit_size AS p_min_unit_size,
                     f_add_llm_price_time_missing.p_max_unit_size AS p_max_unit_size,
                     f_add_llm_price_time_missing.p_is_batch AS p_is_batch,
                     sm.is_input
                    FROM public.llm_supported_modality sm
                   WHERE ((sm.llm_supported_modality_id = f_add_llm_price_time_missing.p_llm_supported_modality_id) AND (sm.llm_id = f_add_llm_price_time_missing.p_llm_id) AND (EXISTS ( SELECT 1
                            FROM public.app_user_role_assignment
                           WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                          FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                            FROM public.currency
                           WHERE ((currency.currency_code = f_add_llm_price_time_missing.p_currency_code) AND (currency.is_active = true))
                          FOR SHARE OF currency)) AND (EXISTS ( SELECT 1
                            FROM public.llm
                           WHERE (llm.llm_id = f_add_llm_price_time_missing.p_llm_id)
                          FOR SHARE OF llm)))
           RETURNING llm_price.llm_price_id
         )
  INSERT INTO public.llm_price_modality (llm_supported_modality_id, llm_price_id)  SELECT f_add_llm_price_time_missing.p_llm_supported_modality_id AS p_llm_supported_modality_id,
             inserted_price.llm_price_id
            FROM inserted_price
   RETURNING llm_price_modality.llm_price_id;
END;

ALTER FUNCTION public.f_add_llm_price_time_missing(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_add_llm_price_time_missing(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean) IS 'This function inserts new LLM price data without explicitly providing validity times, so database defaults are used.';

CREATE TABLE public.language (
    language_code character(3) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_language_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_language_language_code CHECK ((language_code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT chk_language_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:] ]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.language OWNER TO app_superuser;

CREATE VIEW public.language_active WITH (security_barrier='true') AS
 SELECT language_code,
    name AS language_name
   FROM public.language
  WHERE (is_active = true)
  WITH CASCADED CHECK OPTION;

ALTER VIEW public.language_active OWNER TO app_superuser;

COMMENT ON VIEW public.language_active IS 'The view retrieves data about all active languages from the classifier table Language. The three-letter international language code and the language name in Estonian are returned.';

CREATE TABLE public.llm_supported_language (
    language_code character(3) NOT NULL,
    llm_id bigint NOT NULL
)
WITH (fillfactor='90');

ALTER TABLE public.llm_supported_language OWNER TO app_superuser;

CREATE FUNCTION public.f_add_llm_supported_language(p_language_code character, p_llm_id bigint) RETURNS character
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 INSERT INTO public.llm_supported_language (language_code, llm_id)  SELECT f_add_llm_supported_language.p_language_code AS p_language_code,
             f_add_llm_supported_language.p_llm_id AS p_llm_id
           WHERE ((EXISTS ( SELECT 1
                    FROM public.app_user_role_assignment
                   WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                  FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                    FROM public.language_active
                   WHERE (language_active.language_code = f_add_llm_supported_language.p_language_code)
                  FOR SHARE OF language_active)) AND (EXISTS ( SELECT 1
                    FROM public.llm
                   WHERE (llm.llm_id = f_add_llm_supported_language.p_llm_id)
                  FOR SHARE OF llm)))
   RETURNING llm_supported_language.language_code;
END;

ALTER FUNCTION public.f_add_llm_supported_language(p_language_code character, p_llm_id bigint) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_add_llm_supported_language(p_language_code character, p_llm_id bigint) IS 'This function inserts a new supported language record for a language model.';

CREATE TABLE public.modality (
    modality_code character(1) NOT NULL,
    name character varying(30) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_modality_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_modality_modality_code CHECK ((modality_code ~ '^[A-Z]{1}$'::text)),
    CONSTRAINT chk_modality_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alpha:] ]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.modality OWNER TO app_superuser;

CREATE VIEW public.modality_active WITH (security_barrier='true') AS
 SELECT modality_code,
    name AS modality_name
   FROM public.modality
  WHERE (is_active = true)
  WITH CASCADED CHECK OPTION;

ALTER VIEW public.modality_active OWNER TO app_superuser;

COMMENT ON VIEW public.modality_active IS 'The view retrieves data about all active modalities from the classifier table Modality. Modalities describe the capability of a language model to process information in different forms, both input and output. The one-letter modality code and the modality name in Estonian are returned.';

CREATE FUNCTION public.f_add_llm_supported_modality(p_llm_id bigint, p_modality_code character, p_is_input boolean) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 INSERT INTO public.llm_supported_modality (llm_id, modality_code, is_input)  SELECT f_add_llm_supported_modality.p_llm_id AS p_llm_id,
             f_add_llm_supported_modality.p_modality_code AS p_modality_code,
             f_add_llm_supported_modality.p_is_input AS p_is_input
           WHERE ((EXISTS ( SELECT 1
                    FROM public.app_user_role_assignment
                   WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                  FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                    FROM public.modality_active
                   WHERE (modality_active.modality_code = f_add_llm_supported_modality.p_modality_code)
                  FOR SHARE OF modality_active)) AND (EXISTS ( SELECT 1
                    FROM public.llm
                   WHERE (llm.llm_id = f_add_llm_supported_modality.p_llm_id)
                  FOR SHARE OF llm)))
   RETURNING llm_supported_modality.llm_supported_modality_id;
END;

ALTER FUNCTION public.f_add_llm_supported_modality(p_llm_id bigint, p_modality_code character, p_is_input boolean) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_add_llm_supported_modality(p_llm_id bigint, p_modality_code character, p_is_input boolean) IS 'This function inserts a new supported modality record for a language model.';

CREATE FUNCTION public.f_automatic_insert_creator() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.creator := current_setting('myapp.current_user_id')::BIGINT;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.f_automatic_insert_creator() OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_automatic_insert_creator() IS 'Automatically assigns creator according to who inserted the row into the table.';

CREATE FUNCTION public.f_automatic_update_modified_at_time() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.modified_at_time := date_trunc('second', CURRENT_TIMESTAMP);
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.f_automatic_update_modified_at_time() OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_automatic_update_modified_at_time() IS 'Automatically updates modified_at_time according to when the row was changed.';

CREATE FUNCTION public.f_automatic_update_modifier() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.modifier := current_setting('myapp.current_user_id')::BIGINT;
    RETURN NEW;
END;
$$;

ALTER FUNCTION public.f_automatic_update_modifier() OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_automatic_update_modifier() IS 'Automatically updates modifier according to who made the change.';

CREATE FUNCTION public.f_create_chat(p_app_user_id bigint, p_title character varying DEFAULT NULL::character varying) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_chat_id bigint;
    v_title varchar(30);
BEGIN
    INSERT INTO chat (title, app_user_id)
    VALUES (
        COALESCE(p_title, 'TEMP'),
        p_app_user_id
    )
    RETURNING chat_id INTO v_chat_id;

    IF p_title IS NULL THEN
        v_title := left('Chat ' || v_chat_id::text, 30);

        UPDATE chat
        SET title = v_title
        WHERE chat_id = v_chat_id;
    END IF;

    RETURN v_chat_id;
END;
$$;

ALTER FUNCTION public.f_create_chat(p_app_user_id bigint, p_title character varying) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_create_chat(p_app_user_id bigint, p_title character varying) IS 'Creates a chat and automatically assigns a fallback title based on the created chat_id when no title is provided.';

CREATE FUNCTION public.f_current_llm_price(p_llm_id bigint, p_is_input boolean DEFAULT true, p_is_batch boolean DEFAULT false, p_currency_code character DEFAULT NULL::bpchar, p_unit_type_code character DEFAULT NULL::bpchar, p_at_time timestamp with time zone DEFAULT CURRENT_TIMESTAMP) RETURNS TABLE(llm_price_id bigint, llm_id bigint, currency_code character, unit_type_code character, price_per_unit numeric, unit_size integer, min_unit_size integer, max_unit_size integer, is_batch boolean, is_input boolean, valid_from_time timestamp with time zone, valid_until_time timestamp with time zone)
    LANGUAGE sql STABLE
    AS $$
    SELECT
        lp.llm_price_id,
        lp.llm_id,
        lp.currency_code,
        lp.unit_type_code,
        lp.price_per_unit,
        lp.unit_size,
        lp.min_unit_size,
        lp.max_unit_size,
        lp.is_batch,
        lp.is_input,
        lp.valid_from_time,
        lp.valid_until_time
    FROM llm_price lp
    WHERE lp.llm_id = p_llm_id
      AND lp.is_input = p_is_input
      AND lp.is_batch = p_is_batch
      AND (p_currency_code IS NULL OR lp.currency_code = p_currency_code)
      AND (p_unit_type_code IS NULL OR lp.unit_type_code = p_unit_type_code)
      AND p_at_time >= lp.valid_from_time
      AND p_at_time < lp.valid_until_time
    ORDER BY lp.valid_from_time DESC
    LIMIT 1;
$$;

ALTER FUNCTION public.f_current_llm_price(p_llm_id bigint, p_is_input boolean, p_is_batch boolean, p_currency_code character, p_unit_type_code character, p_at_time timestamp with time zone) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_current_llm_price(p_llm_id bigint, p_is_input boolean, p_is_batch boolean, p_currency_code character, p_unit_type_code character, p_at_time timestamp with time zone) IS 'Returns the current LLM price row matching the requested pricing dimension at the specified timestamp.';

CREATE FUNCTION public.f_deactivate_llm(p_llm_id bigint) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 UPDATE public.llm SET is_active = false, modifier = (current_setting('myapp.current_user_id'::text))::bigint, modified_at_time = date_trunc('second'::text, CURRENT_TIMESTAMP)
   WHERE ((llm.llm_id = f_deactivate_llm.p_llm_id) AND (llm.is_active = true) AND (EXISTS ( SELECT 1
            FROM public.app_user_role_assignment
           WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
          FOR SHARE OF app_user_role_assignment)))
   RETURNING llm.llm_id;
END;

ALTER FUNCTION public.f_deactivate_llm(p_llm_id bigint) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_deactivate_llm(p_llm_id bigint) IS 'This function sets the specified language model to active status FALSE, removing the possibility of using it in chats.';

CREATE FUNCTION public.f_delete_active_llm_forbidden() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'An active language model cannot be deleted. First deactivate the language model and then delete it.';
END;
$$;

ALTER FUNCTION public.f_delete_active_llm_forbidden() OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_delete_active_llm_forbidden() IS 'Prevents deletion of an active language model. Only inactive language models may be deleted.';

CREATE FUNCTION public.f_has_access(p_app_user_id bigint, p_resource_id bigint) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
WITH RECURSIVE resource_parent AS (
    SELECT
        r.resource_id,
        NULL::bigint AS parent_resource_id
    FROM resource r
    JOIN resource_database rd
      ON rd.database_id = r.resource_id

    UNION ALL

    SELECT
        rs.schema_id AS resource_id,
        rs.database_id AS parent_resource_id
    FROM resource_schema rs

    UNION ALL

    SELECT
        rt.table_id AS resource_id,
        rt.schema_id AS parent_resource_id
    FROM resource_table rt

    UNION ALL

    SELECT
        rc.column_id AS resource_id,
        rc.table_id AS parent_resource_id
    FROM resource_column rc
),
ancestor_chain AS (
    SELECT rp.resource_id, rp.parent_resource_id
    FROM resource_parent rp
    WHERE rp.resource_id = p_resource_id

    UNION ALL

    SELECT rp.resource_id, rp.parent_resource_id
    FROM resource_parent rp
    JOIN ancestor_chain ac
      ON rp.resource_id = ac.parent_resource_id
)
SELECT EXISTS (
    SELECT 1
    FROM ancestor_chain ac
    JOIN access_right ar
      ON ar.resource_id = ac.resource_id
    JOIN app_user_group_member augm
      ON augm.user_group_code = ar.user_group_code
    WHERE augm.app_user_id = p_app_user_id
);
$$;

ALTER FUNCTION public.f_has_access(p_app_user_id bigint, p_resource_id bigint) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_has_access(p_app_user_id bigint, p_resource_id bigint) IS 'Returns true when the user has access to the resource directly or through access granted on an ancestor resource.';

CREATE FUNCTION public.f_has_select_validate_query(p_query text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_query text;
BEGIN
    IF p_query IS NULL OR char_length(trim(p_query)) = 0 THEN
        RETURN FALSE;
    END IF;

    v_query := trim(p_query);

    -- Must start with SELECT or WITH
    IF v_query !~* '^(select|with)\b' THEN
        RETURN FALSE;
    END IF;

    -- No SQL comments
    IF v_query ~ '--' OR v_query ~ '/\*' OR v_query ~ '\*/' THEN
        RETURN FALSE;
    END IF;

    -- No multiple statements
    IF v_query ~ ';' THEN
        RETURN FALSE;
    END IF;

    -- Block obvious write / DDL / execution keywords
    IF v_query ~* '\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|comment|copy|vacuum|analyze|refresh|merge|call|execute|do)\b' THEN
        RETURN FALSE;
    END IF;

    RETURN TRUE;
END;
$$;

ALTER FUNCTION public.f_has_select_validate_query(p_query text) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_has_select_validate_query(p_query text) IS 'Returns true only for single-statement read-only SELECT/WITH queries with comments and obvious write/DDL keywords blocked.';

CREATE FUNCTION public.f_immutable_created_at_time() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'The column created_at_time is immutable and cannot be changed.';
END;
$$;

ALTER FUNCTION public.f_immutable_created_at_time() OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_immutable_created_at_time() IS 'Prevents the user from changing the values of the created_at_time column, because these are immutable values assigned when the row is inserted.';

CREATE FUNCTION public.f_immutable_creator() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'The column creator is immutable and cannot be changed.';
END;
$$;

ALTER FUNCTION public.f_immutable_creator() OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_immutable_creator() IS 'Prevents the user from changing the values of the creator column, because these are immutable values assigned when the row is inserted.';

CREATE TABLE public.account (
    app_user_id bigint NOT NULL,
    password_hash public.d_bcrypt_hash NOT NULL,
    created_at_time public.d_start_created_modified_at_time NOT NULL,
    modified_at_time public.d_start_created_modified_at_time NOT NULL,
    CONSTRAINT chk_account_created_at_time_before_modified CHECK (((created_at_time)::timestamp with time zone <= (modified_at_time)::timestamp with time zone)),
    CONSTRAINT chk_account_password_hash CHECK (((password_hash)::text ~ '^\$2[aby]\$\d{2}\$[./[:alnum:]]{53}$'::text))
);

ALTER TABLE public.account OWNER TO app_superuser;

CREATE TABLE public.app_user (
    app_user_id bigint NOT NULL,
    creator bigint,
    preferred_llm_language character(3) DEFAULT 'EST'::bpchar NOT NULL,
    email public.d_email_ci NOT NULL,
    llm_custom_global_instruction text,
    is_active boolean DEFAULT true NOT NULL,
    created_at_time public.d_start_created_modified_at_time NOT NULL,
    modified_at_time public.d_start_created_modified_at_time NOT NULL,
    CONSTRAINT chk_app_user_created_at_time_before_modified CHECK (((created_at_time)::timestamp with time zone <= (modified_at_time)::timestamp with time zone)),
    CONSTRAINT chk_app_user_creator_cannot_be_equal_to_same_user CHECK ((app_user_id <> creator)),
    CONSTRAINT chk_app_user_email CHECK (((email)::text ~~ '%@%'::text)),
    CONSTRAINT chk_app_user_llm_custom_global_instruction CHECK ((llm_custom_global_instruction ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.app_user OWNER TO app_superuser;

CREATE FUNCTION public.f_is_active_with_correct_password(p_email public.d_email_ci, p_password text) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 SELECT au.app_user_id
    FROM (public.app_user au
      JOIN public.account a USING (app_user_id))
   WHERE ((upper((au.email)::text) = upper((f_is_active_with_correct_password.p_email)::text)) AND (au.is_active = true) AND ((a.password_hash)::text = extensions.crypt(f_is_active_with_correct_password.p_password, (a.password_hash)::text)));
END;

ALTER FUNCTION public.f_is_active_with_correct_password(p_email public.d_email_ci, p_password text) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_is_active_with_correct_password(p_email public.d_email_ci, p_password text) IS 'This function identifies the user attempting to log in by email in a case-insensitive way, verifies the entered password by comparing it with the hashed and salted password stored in the system.';

CREATE FUNCTION public.f_log_sql_query(p_chat_id bigint, p_trigger_message_id bigint, p_result_type_code character, p_query text, p_is_successful boolean DEFAULT true, p_execution_time_ms integer DEFAULT NULL::integer, p_result_row_count integer DEFAULT NULL::integer, p_error_message character varying DEFAULT NULL::character varying) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_sql_query_id bigint;
BEGIN
    IF NOT f_has_select_validate_query(p_query) THEN
        RAISE EXCEPTION 'Only a single read-only SELECT/WITH query may be logged.';
    END IF;

    INSERT INTO sql_query (
        chat_id,
        trigger_message_id,
        result_type_code,
        query,
        is_successful,
        execution_time_ms,
        result_row_count,
        error_message
    )
    VALUES (
        p_chat_id,
        p_trigger_message_id,
        p_result_type_code,
        p_query,
        p_is_successful,
        p_execution_time_ms,
        p_result_row_count,
        p_error_message
    )
    RETURNING sql_query_id INTO v_sql_query_id;

    RETURN v_sql_query_id;
END;
$$;

ALTER FUNCTION public.f_log_sql_query(p_chat_id bigint, p_trigger_message_id bigint, p_result_type_code character, p_query text, p_is_successful boolean, p_execution_time_ms integer, p_result_row_count integer, p_error_message character varying) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_log_sql_query(p_chat_id bigint, p_trigger_message_id bigint, p_result_type_code character, p_query text, p_is_successful boolean, p_execution_time_ms integer, p_result_row_count integer, p_error_message character varying) IS 'Validates and logs a generated SQL query into SQL_query.';

CREATE FUNCTION public.f_log_sql_query(p_chat_id bigint, p_trigger_message_id bigint, p_result_type_code character, p_query text, p_generated_prompt_context character varying, p_is_successful boolean DEFAULT true, p_execution_time_ms integer DEFAULT NULL::integer, p_result_row_count integer DEFAULT NULL::integer, p_error_message character varying DEFAULT NULL::character varying) RETURNS bigint
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_sql_query_id bigint;
BEGIN
    IF NOT f_has_select_validate_query(p_query) THEN
        RAISE EXCEPTION 'Only a single read-only SELECT/WITH query may be logged.';
    END IF;

    INSERT INTO sql_query (
        chat_id,
        trigger_message_id,
        result_type_code,
        query,
        generated_prompt_context,
        is_successful,
        execution_time_ms,
        result_row_count,
        error_message
    )
    VALUES (
        p_chat_id,
        p_trigger_message_id,
        p_result_type_code,
        p_query,
        p_generated_prompt_context,
        p_is_successful,
        p_execution_time_ms,
        p_result_row_count,
        p_error_message
    )
    RETURNING sql_query_id INTO v_sql_query_id;

    RETURN v_sql_query_id;
END;
$$;

ALTER FUNCTION public.f_log_sql_query(p_chat_id bigint, p_trigger_message_id bigint, p_result_type_code character, p_query text, p_generated_prompt_context character varying, p_is_successful boolean, p_execution_time_ms integer, p_result_row_count integer, p_error_message character varying) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_log_sql_query(p_chat_id bigint, p_trigger_message_id bigint, p_result_type_code character, p_query text, p_generated_prompt_context character varying, p_is_successful boolean, p_execution_time_ms integer, p_result_row_count integer, p_error_message character varying) IS 'Validates and logs a generated SQL query into SQL_query.';

CREATE FUNCTION public.f_remove_llm(p_llm_id bigint) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 WITH validation AS (
          SELECT ((EXISTS ( SELECT 1
                    FROM public.app_user_role_assignment
                   WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                  FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                    FROM public.llm
                   WHERE ((llm.llm_id = f_remove_llm.p_llm_id) AND (llm.is_active = false))
                  FOR SHARE OF llm))) AS all_ok
         ), deleted_row AS (
          DELETE FROM public.llm l
            USING validation
           WHERE ((l.llm_id = f_remove_llm.p_llm_id) AND (validation.all_ok = true))
           RETURNING l.llm_id
         )
  SELECT deleted_row.llm_id
    FROM deleted_row;
END;

ALTER FUNCTION public.f_remove_llm(p_llm_id bigint) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_remove_llm(p_llm_id bigint) IS 'This function permanently deletes a language model from the LLM table by its ID, but only if the model is inactive. If the model is not found or the deletion does not take place, NULL is returned.';

CREATE FUNCTION public.f_remove_llm_api(p_llm_api_id bigint) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 WITH validation AS (
          SELECT ((EXISTS ( SELECT 1
                    FROM public.app_user_role_assignment
                   WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                  FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                    FROM public.llm_api
                   WHERE (llm_api.llm_api_id = f_remove_llm_api.p_llm_api_id)
                  FOR SHARE OF llm_api))) AS all_ok
         ), deleted_row AS (
          DELETE FROM public.llm_api a
            USING validation
           WHERE ((a.llm_api_id = f_remove_llm_api.p_llm_api_id) AND (validation.all_ok = true))
           RETURNING a.llm_api_id
         )
  SELECT deleted_row.llm_api_id
    FROM deleted_row;
END;

ALTER FUNCTION public.f_remove_llm_api(p_llm_api_id bigint) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_remove_llm_api(p_llm_api_id bigint) IS 'This function permanently deletes an LLM API record from the LLM_api table by its ID. If the API record is not found or the deletion does not take place, NULL is returned.';

CREATE FUNCTION public.f_remove_llm_price(p_llm_price_id bigint) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 WITH validation AS (
          SELECT ((EXISTS ( SELECT 1
                    FROM public.app_user_role_assignment
                   WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                  FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                    FROM public.llm_price
                   WHERE (llm_price.llm_price_id = f_remove_llm_price.p_llm_price_id)
                  FOR SHARE OF llm_price))) AS all_ok
         ), deleted_link AS (
          DELETE FROM public.llm_price_modality
            USING validation
           WHERE ((llm_price_modality.llm_price_id = f_remove_llm_price.p_llm_price_id) AND (validation.all_ok = true))
           RETURNING llm_price_modality.llm_price_id
         ), deleted_price AS (
          DELETE FROM public.llm_price
            USING validation
           WHERE ((llm_price.llm_price_id = f_remove_llm_price.p_llm_price_id) AND (validation.all_ok = true))
           RETURNING llm_price.llm_price_id
         )
  SELECT deleted_price.llm_price_id
    FROM deleted_price;
END;

ALTER FUNCTION public.f_remove_llm_price(p_llm_price_id bigint) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_remove_llm_price(p_llm_price_id bigint) IS 'This function permanently deletes an LLM price from the LLM_price table by its ID. If the price is not found or the deletion does not take place, NULL is returned.';

CREATE FUNCTION public.f_remove_llm_supported_language(p_llm_id bigint, p_language_code character) RETURNS character
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 WITH validation AS (
          SELECT ((EXISTS ( SELECT 1
                    FROM public.app_user_role_assignment
                   WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                  FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                    FROM public.llm_supported_language
                   WHERE ((llm_supported_language.llm_id = f_remove_llm_supported_language.p_llm_id) AND (llm_supported_language.language_code = f_remove_llm_supported_language.p_language_code))
                  FOR SHARE OF llm_supported_language))) AS all_ok
         ), deleted_row AS (
          DELETE FROM public.llm_supported_language lsl
            USING validation
           WHERE ((lsl.llm_id = f_remove_llm_supported_language.p_llm_id) AND (lsl.language_code = f_remove_llm_supported_language.p_language_code) AND (validation.all_ok = true))
           RETURNING lsl.language_code
         )
  SELECT deleted_row.language_code
    FROM deleted_row;
END;

ALTER FUNCTION public.f_remove_llm_supported_language(p_llm_id bigint, p_language_code character) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_remove_llm_supported_language(p_llm_id bigint, p_language_code character) IS 'This function permanently deletes a supported language record from the LLM_supported_language table by its composite key. If the record is not found or the deletion does not take place, NULL is returned.';

CREATE FUNCTION public.f_remove_llm_supported_modality(p_llm_supported_modality_id bigint) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 WITH validation AS (
          SELECT ((EXISTS ( SELECT 1
                    FROM public.app_user_role_assignment
                   WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                  FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                    FROM public.llm_supported_modality
                   WHERE (llm_supported_modality.llm_supported_modality_id = f_remove_llm_supported_modality.p_llm_supported_modality_id)
                  FOR SHARE OF llm_supported_modality))) AS all_ok
         ), deleted_row AS (
          DELETE FROM public.llm_supported_modality lsm
            USING validation
           WHERE ((lsm.llm_supported_modality_id = f_remove_llm_supported_modality.p_llm_supported_modality_id) AND (validation.all_ok = true))
           RETURNING lsm.llm_supported_modality_id
         )
  SELECT deleted_row.llm_supported_modality_id
    FROM deleted_row;
END;

ALTER FUNCTION public.f_remove_llm_supported_modality(p_llm_supported_modality_id bigint) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_remove_llm_supported_modality(p_llm_supported_modality_id bigint) IS 'This function permanently deletes a supported modality record from the LLM_supported_modality table by its ID. If the record is not found or the deletion does not take place, NULL is returned.';

CREATE FUNCTION public.f_update_llm(p_llm_id bigint, p_llm_group_id integer, p_model_name character varying, p_version character varying, p_context_length public.d_positive_int, p_max_output_tokens public.d_positive_int, p_other_parameters jsonb, p_release_date date, p_is_local boolean, p_is_active boolean) RETURNS bigint
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    BEGIN ATOMIC
 WITH validation AS (
          SELECT ((EXISTS ( SELECT 1
                    FROM public.app_user_role_assignment
                   WHERE ((app_user_role_assignment.app_user_id = (current_setting('myapp.current_user_id'::text))::bigint) AND (app_user_role_assignment.user_role_code = 'ADM'::bpchar))
                  FOR SHARE OF app_user_role_assignment)) AND (EXISTS ( SELECT 1
                    FROM public.llm_group
                   WHERE ((llm_group.llm_group_id = f_update_llm.p_llm_group_id) AND (llm_group.is_active = true))
                  FOR SHARE OF llm_group))) AS all_ok
         )
  UPDATE public.llm SET model_name = f_update_llm.p_model_name, llm_group_id = f_update_llm.p_llm_group_id, version = f_update_llm.p_version, context_length = f_update_llm.p_context_length, max_output_tokens = f_update_llm.p_max_output_tokens, other_parameters = f_update_llm.p_other_parameters, release_date = f_update_llm.p_release_date, is_local = f_update_llm.p_is_local, is_active = f_update_llm.p_is_active, modifier = (current_setting('myapp.current_user_id'::text))::bigint, modified_at_time = date_trunc('second'::text, CURRENT_TIMESTAMP)
    FROM validation
   WHERE ((llm.llm_id = f_update_llm.p_llm_id) AND (validation.all_ok = true))
   RETURNING llm.llm_id;
END;

ALTER FUNCTION public.f_update_llm(p_llm_id bigint, p_llm_group_id integer, p_model_name character varying, p_version character varying, p_context_length public.d_positive_int, p_max_output_tokens public.d_positive_int, p_other_parameters jsonb, p_release_date date, p_is_local boolean, p_is_active boolean) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_update_llm(p_llm_id bigint, p_llm_group_id integer, p_model_name character varying, p_version character varying, p_context_length public.d_positive_int, p_max_output_tokens public.d_positive_int, p_other_parameters jsonb, p_release_date date, p_is_local boolean, p_is_active boolean) IS 'This function updates an existing language model in the LLM table. All LLM attributes can be changed except the creator and creation time.';

CREATE FUNCTION public.f_update_llm_api(p_llm_api_id bigint, p_llm_id bigint, p_encrypted_api_key text, p_encrypted_request_url text, p_is_active boolean, p_token_limit_per_minute public.d_positive_int, p_request_limit_per_minute public.d_positive_int, p_request_limit_per_day public.d_positive_int) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_id llm_api.llm_api_id%TYPE;
BEGIN
    UPDATE llm_api
    SET llm_id = p_llm_id,
        encrypted_api_key = p_encrypted_api_key,
        encrypted_request_url = p_encrypted_request_url,
        is_active = p_is_active,
        token_limit_per_minute = p_token_limit_per_minute,
        request_limit_per_minute = p_request_limit_per_minute,
        request_limit_per_day = p_request_limit_per_day
    WHERE llm_api_id = p_llm_api_id
      AND EXISTS (
          SELECT 1 FROM app_user_role_assignment
          WHERE app_user_id = current_setting('myapp.current_user_id')::BIGINT
            AND user_role_code = 'ADM'
          FOR SHARE
      )
    RETURNING llm_api_id INTO v_id;

    RETURN v_id;
END;
$$;

ALTER FUNCTION public.f_update_llm_api(p_llm_api_id bigint, p_llm_id bigint, p_encrypted_api_key text, p_encrypted_request_url text, p_is_active boolean, p_token_limit_per_minute public.d_positive_int, p_request_limit_per_minute public.d_positive_int, p_request_limit_per_day public.d_positive_int) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_update_llm_api(p_llm_api_id bigint, p_llm_id bigint, p_encrypted_api_key text, p_encrypted_request_url text, p_is_active boolean, p_token_limit_per_minute public.d_positive_int, p_request_limit_per_minute public.d_positive_int, p_request_limit_per_day public.d_positive_int) IS 'This function updates existing LLM API data. All API attributes can be changed.';

CREATE FUNCTION public.f_update_llm_api(p_llm_api_id bigint, p_llm_id bigint, p_api_key character varying, p_request_url public.d_https_url, p_is_active boolean, p_token_limit_per_minute public.d_positive_int, p_request_limit_per_minute public.d_positive_int, p_request_limit_per_day public.d_positive_int) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_id llm_api.llm_api_id%TYPE;
BEGIN
    UPDATE llm_api
    SET llm_id = p_llm_id,
        api_key = p_api_key,
        request_url = p_request_url,
        is_active = p_is_active,
        token_limit_per_minute = p_token_limit_per_minute,
        request_limit_per_minute = p_request_limit_per_minute,
        request_limit_per_day = p_request_limit_per_day
    WHERE llm_api_id = p_llm_api_id
      AND EXISTS (
          SELECT 1 FROM app_user_role_assignment
          WHERE app_user_id = current_setting('myapp.current_user_id')::BIGINT
            AND user_role_code = 'ADM'
          FOR SHARE
      )
    RETURNING llm_api_id INTO v_id;

    RETURN v_id;
END;
$$;

ALTER FUNCTION public.f_update_llm_api(p_llm_api_id bigint, p_llm_id bigint, p_api_key character varying, p_request_url public.d_https_url, p_is_active boolean, p_token_limit_per_minute public.d_positive_int, p_request_limit_per_minute public.d_positive_int, p_request_limit_per_day public.d_positive_int) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_update_llm_api(p_llm_api_id bigint, p_llm_id bigint, p_api_key character varying, p_request_url public.d_https_url, p_is_active boolean, p_token_limit_per_minute public.d_positive_int, p_request_limit_per_minute public.d_positive_int, p_request_limit_per_day public.d_positive_int) IS 'This function updates existing LLM API data. All API attributes can be changed.';

CREATE FUNCTION public.f_update_llm_price(p_llm_price_id bigint, p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_from_time public.d_start_created_modified_at_time DEFAULT NULL::timestamp with time zone, p_valid_until_time timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_price_id llm_price.llm_price_id%TYPE;
    v_is_input llm_supported_modality.is_input%TYPE;
BEGIN
    SELECT is_input
    INTO v_is_input
    FROM llm_supported_modality
    WHERE llm_supported_modality_id = p_llm_supported_modality_id AND llm_id = p_llm_id;
    UPDATE llm_price
    SET llm_id = p_llm_id,
        currency_code = p_currency_code,
        unit_type_code = p_unit_type_code,
        price_per_unit = p_price_per_unit,
        unit_size = p_unit_size,
        min_unit_size = p_min_unit_size,
        max_unit_size = p_max_unit_size,
        is_batch = p_is_batch,
        is_input = v_is_input,
        valid_from_time = COALESCE(p_valid_from_time, valid_from_time),
        valid_until_time = COALESCE(p_valid_until_time, valid_until_time)
    WHERE llm_price_id = p_llm_price_id
      AND EXISTS (
          SELECT 1 FROM app_user_role_assignment
          WHERE app_user_id = current_setting('myapp.current_user_id')::BIGINT
            AND user_role_code = 'ADM'
          FOR SHARE
      )
      AND EXISTS (
          SELECT 1 FROM currency
          WHERE currency_code = p_currency_code AND is_active = TRUE
          FOR SHARE
      )
    RETURNING llm_price_id INTO v_price_id;
    UPDATE llm_price_modality
    SET llm_supported_modality_id = p_llm_supported_modality_id
    WHERE llm_price_id = v_price_id;
    RETURN v_price_id;
END;
$$;

ALTER FUNCTION public.f_update_llm_price(p_llm_price_id bigint, p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_from_time public.d_start_created_modified_at_time, p_valid_until_time timestamp with time zone) OWNER TO app_superuser;

COMMENT ON FUNCTION public.f_update_llm_price(p_llm_price_id bigint, p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_from_time public.d_start_created_modified_at_time, p_valid_until_time timestamp with time zone) IS 'This function updates existing LLM price data, including validity start and end times.';

CREATE PROCEDURE public.p_register_database_resource(IN p_creator bigint, IN p_modifier bigint, IN p_database_name character varying, IN p_description_for_llm text DEFAULT NULL::text, IN p_comment_for_user text DEFAULT NULL::text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_resource_id bigint;
BEGIN
    INSERT INTO resource (
        creator,
        modifier,
        description_for_llm,
        comment_for_user
    )
    VALUES (
        p_creator,
        p_modifier,
        p_description_for_llm,
        p_comment_for_user
    )
    RETURNING resource_id INTO v_resource_id;

    INSERT INTO resource_database (
        database_id,
        name
    )
    VALUES (
        v_resource_id,
        p_database_name
    );
END;
$$;

ALTER PROCEDURE public.p_register_database_resource(IN p_creator bigint, IN p_modifier bigint, IN p_database_name character varying, IN p_description_for_llm text, IN p_comment_for_user text) OWNER TO app_superuser;

COMMENT ON PROCEDURE public.p_register_database_resource(IN p_creator bigint, IN p_modifier bigint, IN p_database_name character varying, IN p_description_for_llm text, IN p_comment_for_user text) IS 'Registers a new database-level resource in one transaction.';

CREATE SERVER minu_testandmete_server_apex FOREIGN DATA WRAPPER postgres_fdw OPTIONS (
    dbname 'testandmed',
    host 'apex2.taltech.ee',
    port '5432'
);

ALTER SERVER minu_testandmete_server_apex OWNER TO app_superuser;

CREATE USER MAPPING FOR app_superuser SERVER minu_testandmete_server_apex OPTIONS (
    password 'TaDsz!tc24uDzkg',
    "user" 'app_superuser'
);

CREATE FOREIGN TABLE external.isik_sisend (
    isik jsonb
)
SERVER minu_testandmete_server_apex
OPTIONS (
    schema_name 'public',
    table_name 'isik_jsonb',
    updatable 'false'
);

ALTER FOREIGN TABLE external.isik_sisend OWNER TO app_superuser;

CREATE FOREIGN TABLE external.riik_sisend (
    riik jsonb
)
SERVER minu_testandmete_server_apex
OPTIONS (
    schema_name 'public',
    table_name 'riik_jsonb',
    updatable 'false'
);

ALTER FOREIGN TABLE external.riik_sisend OWNER TO app_superuser;

CREATE TABLE public.access_right (
    resource_id bigint NOT NULL,
    user_group_code character(5) NOT NULL
)
WITH (fillfactor='90');

ALTER TABLE public.access_right OWNER TO app_superuser;

CREATE TABLE public.company (
    company_code character(10) NOT NULL,
    country_code character(3) NOT NULL,
    name character varying(200) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_company_company_code CHECK ((company_code ~ '^(?=.*[[:alnum:]])[[:alnum:] ]+$'::text)),
    CONSTRAINT chk_company_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_company_name CHECK (((name)::text ~ '^(?=.*[[:alnum:]])[[:alnum:][:punct:] ]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.company OWNER TO app_superuser;

CREATE TABLE public.country (
    country_code character(3) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_country_country_code CHECK ((country_code ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT chk_country_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_country_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:] ]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.country OWNER TO app_superuser;

CREATE VIEW public.active_llm_detailed WITH (security_barrier='true') AS
 SELECT lm.llm_id,
    lm.llm_group_id,
    lm.model_name AS llm_name,
    lg.name AS llm_group_name,
    lg.is_active AS llm_group_is_active,
    c.name AS model_company_name,
    c.is_active AS model_company_is_active,
    co.name AS model_company_country,
    co.is_active AS model_company_country_is_active,
    lm.version AS llm_version,
    lm.context_length AS llm_context_length,
    lm.max_output_tokens AS llm_max_output_tokens,
    lm.other_parameters AS llm_other_parameters,
    lm.release_date AS llm_release_date,
    lm.is_local AS is_local_llm,
    lm.is_active AS is_active_llm,
    lm.created_at_time AS llm_created_at,
    u.email AS llm_creator_email,
    lm.modified_at_time AS llm_last_modified_at,
    u2.email AS llm_last_modifier_email,
    ( SELECT string_agg((l.name)::text, ', '::text ORDER BY (l.name)::text) AS string_agg
           FROM (public.llm_supported_language sl
             LEFT JOIN public.language l USING (language_code))
          WHERE ((sl.llm_id = lm.llm_id) AND (l.is_active = true))) AS llm_supported_languages,
    ( SELECT string_agg(((m.name)::text ||
                CASE
                    WHEN sm.is_input THEN ' (input)'::text
                    ELSE ' (output)'::text
                END), ', '::text ORDER BY m.name) AS string_agg
           FROM (public.llm_supported_modality sm
             LEFT JOIN public.modality m USING (modality_code))
          WHERE ((sm.llm_id = lm.llm_id) AND (m.is_active = true))) AS llm_supported_modalities
   FROM (((((public.llm lm
     LEFT JOIN public.llm_group lg USING (llm_group_id))
     LEFT JOIN public.company c USING (company_code))
     LEFT JOIN public.country co USING (country_code))
     LEFT JOIN public.app_user u ON ((lm.creator = u.app_user_id)))
     LEFT JOIN public.app_user u2 ON ((lm.modifier = u2.app_user_id)))
  WHERE (lm.is_active = true);

ALTER VIEW public.active_llm_detailed OWNER TO app_superuser;

COMMENT ON VIEW public.active_llm_detailed IS 'The view retrieves detailed information about all language models in the system that have an active status.';

CREATE TABLE public.app_user_group_member (
    user_group_code character(5) NOT NULL,
    app_user_id bigint NOT NULL
)
WITH (fillfactor='90');

ALTER TABLE public.app_user_group_member OWNER TO app_superuser;

CREATE TABLE public.resource (
    resource_id bigint NOT NULL,
    creator bigint NOT NULL,
    modifier bigint NOT NULL,
    description_for_llm text,
    comment_for_user text,
    is_active boolean DEFAULT true NOT NULL,
    created_at_time public.d_start_created_modified_at_time NOT NULL,
    modified_at_time public.d_start_created_modified_at_time NOT NULL,
    CONSTRAINT chk_resource_comment_for_user CHECK ((comment_for_user ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_resource_created_at_time_before_modified CHECK (((created_at_time)::timestamp with time zone <= (modified_at_time)::timestamp with time zone)),
    CONSTRAINT chk_resource_description_for_llm CHECK ((description_for_llm ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.resource OWNER TO app_superuser;

CREATE TABLE public.resource_column (
    column_id bigint NOT NULL,
    table_id bigint NOT NULL,
    name character varying(100) NOT NULL,
    CONSTRAINT chk_resource_column_name CHECK (((name)::text ~ '^(?=.*[[:alnum:]])[[:alnum:][:punct:][:space:]]+$'::text))
);

ALTER TABLE public.resource_column OWNER TO app_superuser;

CREATE TABLE public.resource_database (
    database_id bigint NOT NULL,
    name character varying(100) NOT NULL,
    CONSTRAINT chk_resource_database_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text))
);

ALTER TABLE public.resource_database OWNER TO app_superuser;

CREATE TABLE public.resource_schema (
    schema_id bigint NOT NULL,
    database_id bigint NOT NULL,
    name character varying(100) NOT NULL,
    CONSTRAINT chk_resource_schema_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text))
);

ALTER TABLE public.resource_schema OWNER TO app_superuser;

CREATE TABLE public.resource_table (
    table_id bigint NOT NULL,
    schema_id bigint NOT NULL,
    name character varying(100) NOT NULL,
    table_type_id smallint NOT NULL,
    CONSTRAINT chk_resource_table_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text))
);

ALTER TABLE public.resource_table OWNER TO app_superuser;

CREATE VIEW public.app_user_accessible_resources WITH (security_barrier='true') AS
 WITH RECURSIVE resource_edge AS (
         SELECT rd.database_id AS parent_resource_id,
            rs.schema_id AS child_resource_id
           FROM (public.resource_schema rs
             JOIN public.resource_database rd ON ((rd.database_id = rs.database_id)))
        UNION ALL
         SELECT rs.schema_id AS parent_resource_id,
            rt.table_id AS child_resource_id
           FROM (public.resource_table rt
             JOIN public.resource_schema rs ON ((rs.schema_id = rt.schema_id)))
        UNION ALL
         SELECT rt.table_id AS parent_resource_id,
            rc.column_id AS child_resource_id
           FROM (public.resource_column rc
             JOIN public.resource_table rt ON ((rt.table_id = rc.table_id)))
        ), seed_access AS (
         SELECT augm.app_user_id,
            ar.resource_id
           FROM (public.app_user_group_member augm
             JOIN public.access_right ar ON ((ar.user_group_code = augm.user_group_code)))
        ), expanded_access AS (
         SELECT sa.app_user_id,
            sa.resource_id
           FROM seed_access sa
        UNION
         SELECT ea_1.app_user_id,
            re.child_resource_id
           FROM (expanded_access ea_1
             JOIN resource_edge re ON ((re.parent_resource_id = ea_1.resource_id)))
        ), resource_hier_detailed AS (
         SELECT r.resource_id,
            'DATABASE'::text AS resource_level,
            rd.name AS resource_name,
            rd.database_id,
            NULL::bigint AS schema_id,
            NULL::bigint AS table_id,
            NULL::bigint AS column_id,
            rd.name AS database_name,
            NULL::character varying(100) AS schema_name,
            NULL::character varying(100) AS table_name,
            NULL::character varying(100) AS column_name,
            r.description_for_llm,
            r.comment_for_user,
            r.is_active,
            r.created_at_time,
            r.modified_at_time
           FROM (public.resource r
             JOIN public.resource_database rd ON ((rd.database_id = r.resource_id)))
        UNION ALL
         SELECT r.resource_id,
            'SCHEMA'::text AS resource_level,
            rs.name AS resource_name,
            rs.database_id,
            rs.schema_id,
            NULL::bigint AS table_id,
            NULL::bigint AS column_id,
            rd.name AS database_name,
            rs.name AS schema_name,
            NULL::character varying(100) AS table_name,
            NULL::character varying(100) AS column_name,
            r.description_for_llm,
            r.comment_for_user,
            r.is_active,
            r.created_at_time,
            r.modified_at_time
           FROM ((public.resource r
             JOIN public.resource_schema rs ON ((rs.schema_id = r.resource_id)))
             JOIN public.resource_database rd ON ((rd.database_id = rs.database_id)))
        UNION ALL
         SELECT r.resource_id,
            'TABLE'::text AS resource_level,
            rt.name AS resource_name,
            rs.database_id,
            rt.schema_id,
            rt.table_id,
            NULL::bigint AS column_id,
            rd.name AS database_name,
            rs.name AS schema_name,
            rt.name AS table_name,
            NULL::character varying(100) AS column_name,
            r.description_for_llm,
            r.comment_for_user,
            r.is_active,
            r.created_at_time,
            r.modified_at_time
           FROM (((public.resource r
             JOIN public.resource_table rt ON ((rt.table_id = r.resource_id)))
             JOIN public.resource_schema rs ON ((rs.schema_id = rt.schema_id)))
             JOIN public.resource_database rd ON ((rd.database_id = rs.database_id)))
        UNION ALL
         SELECT r.resource_id,
            'COLUMN'::text AS resource_level,
            rc.name AS resource_name,
            rs.database_id,
            rt.schema_id,
            rc.table_id,
            rc.column_id,
            rd.name AS database_name,
            rs.name AS schema_name,
            rt.name AS table_name,
            rc.name AS column_name,
            r.description_for_llm,
            r.comment_for_user,
            r.is_active,
            r.created_at_time,
            r.modified_at_time
           FROM ((((public.resource r
             JOIN public.resource_column rc ON ((rc.column_id = r.resource_id)))
             JOIN public.resource_table rt ON ((rt.table_id = rc.table_id)))
             JOIN public.resource_schema rs ON ((rs.schema_id = rt.schema_id)))
             JOIN public.resource_database rd ON ((rd.database_id = rs.database_id)))
        )
 SELECT DISTINCT ea.app_user_id,
    au.email,
    rhd.resource_id,
    rhd.resource_level,
    rhd.database_name,
    rhd.schema_name,
    rhd.table_name,
    rhd.column_name,
    rhd.resource_name
   FROM ((expanded_access ea
     JOIN public.app_user au ON ((au.app_user_id = ea.app_user_id)))
     JOIN resource_hier_detailed rhd ON ((rhd.resource_id = ea.resource_id)));

ALTER VIEW public.app_user_accessible_resources OWNER TO app_superuser;

COMMENT ON VIEW public.app_user_accessible_resources IS 'Shows all resources each user can access, including descendants inherited from ancestor-level grants.';

CREATE TABLE public.user_role (
    user_role_code character(3) NOT NULL,
    name character varying(15) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_user_role_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_user_role_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alpha:] ]+$'::text)),
    CONSTRAINT chk_user_role_user_role_code CHECK ((user_role_code ~ '^[A-Z]{3}$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.user_role OWNER TO app_superuser;

CREATE VIEW public.app_user_active_with_roles WITH (security_barrier='true') AS
 SELECT au.app_user_id,
    au.email,
    au.preferred_llm_language,
    au.llm_custom_global_instruction,
    string_agg((ur.user_role_code)::text, ', '::text) AS user_role_codes,
    string_agg((ur.name)::text, ', '::text) AS user_role_names
   FROM ((public.app_user au
     LEFT JOIN public.app_user_role_assignment aura USING (app_user_id))
     LEFT JOIN public.user_role ur USING (user_role_code))
  WHERE ((au.is_active = true) AND (ur.is_active = true))
  GROUP BY au.app_user_id, au.email, au.preferred_llm_language, au.llm_custom_global_instruction;

ALTER VIEW public.app_user_active_with_roles OWNER TO app_superuser;

COMMENT ON VIEW public.app_user_active_with_roles IS 'The view retrieves information about active app users and their active roles.';

ALTER TABLE public.app_user ALTER COLUMN app_user_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.app_user_app_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.app_user_effective_roles WITH (security_barrier='true') AS
 SELECT au.app_user_id,
    au.email,
    ur.user_role_code,
    ur.name AS user_role_name,
    ur.description AS user_role_description
   FROM ((public.app_user au
     JOIN public.app_user_role_assignment aura ON ((aura.app_user_id = au.app_user_id)))
     JOIN public.user_role ur ON ((ur.user_role_code = aura.user_role_code)))
  WHERE ((au.is_active = true) AND (ur.is_active = true));

ALTER VIEW public.app_user_effective_roles OWNER TO app_superuser;

COMMENT ON VIEW public.app_user_effective_roles IS 'Shows active users together with their directly assigned active roles.';

CREATE TABLE public.chat (
    chat_id bigint NOT NULL,
    chat_title character varying(30) CONSTRAINT chat_title_not_null NOT NULL,
    app_user_id bigint NOT NULL,
    is_hidden boolean DEFAULT false NOT NULL,
    modified_at_time public.d_start_created_modified_at_time NOT NULL,
    CONSTRAINT chk_chat_title CHECK (((chat_title)::text !~ '^[[:space:]]*$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.chat OWNER TO app_superuser;

ALTER TABLE public.chat ALTER COLUMN chat_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.chat_chat_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.company_active WITH (security_barrier='true') AS
 SELECT c.company_code,
    r.country_code AS company_country_code,
    c.name AS company_name
   FROM (public.company c
     LEFT JOIN public.country r USING (country_code))
  WHERE ((c.is_active = true) AND (r.is_active = true));

ALTER VIEW public.company_active OWNER TO app_superuser;

COMMENT ON VIEW public.company_active IS 'The view retrieves data about all active companies from the classifier table Company. The internal company code and the company name are returned.';

CREATE VIEW public.country_active WITH (security_barrier='true') AS
 SELECT country_code,
    name AS country_name
   FROM public.country
  WHERE (is_active = true)
  WITH CASCADED CHECK OPTION;

ALTER VIEW public.country_active OWNER TO app_superuser;

COMMENT ON VIEW public.country_active IS 'The view retrieves data about all active countries from the classifier table Country. The three-letter international country code and the country name in English are returned.';

CREATE VIEW public.currency_active WITH (security_barrier='true') AS
 SELECT currency_code,
    name AS currency_name
   FROM public.currency
  WHERE (is_active = true)
  WITH CASCADED CHECK OPTION;

ALTER VIEW public.currency_active OWNER TO app_superuser;

COMMENT ON VIEW public.currency_active IS 'The view retrieves data about all active currencies from the classifier table Currency. The three-letter international currency code and the currency name in Estonian are returned.';

CREATE VIEW public.current_llm_price_detailed WITH (security_barrier='true') AS
 SELECT lm.llm_id,
    lp.llm_price_id,
    lm.model_name AS llm_name,
    lm.is_active AS is_active_llm,
    lp.price_per_unit AS llm_price_per_unit,
    lp.unit_size AS llm_unit_size,
    lp.min_unit_size AS llm_min_unit_size,
    lp.max_unit_size AS llm_max_unit_size,
    lp.currency_code AS currency,
    m.name AS modality_name,
    lp.is_input,
    lp.is_batch,
    lp.valid_from_time AS price_valid_from,
    lp.valid_until_time AS price_valid_until
   FROM ((((public.llm lm
     LEFT JOIN public.llm_price lp USING (llm_id))
     LEFT JOIN public.llm_price_modality pm USING (llm_price_id))
     LEFT JOIN public.llm_supported_modality sm USING (llm_supported_modality_id))
     LEFT JOIN public.modality m USING (modality_code))
  WHERE ((CURRENT_TIMESTAMP >= (lp.valid_from_time)::timestamp with time zone) AND (CURRENT_TIMESTAMP < lp.valid_until_time));

ALTER VIEW public.current_llm_price_detailed OWNER TO app_superuser;

COMMENT ON VIEW public.current_llm_price_detailed IS 'Shows only currently valid LLM price rows from llm_price_detailed.';

CREATE TABLE public.database_connection_credential (
    database_connection_credential_id bigint CONSTRAINT database_connection_credent_database_connection_creden_not_null NOT NULL,
    database_id bigint NOT NULL,
    dbms_version_id integer NOT NULL,
    encrypted_host_name text CONSTRAINT database_connection_credential_host_name_not_null NOT NULL,
    port integer NOT NULL,
    encrypted_username text CONSTRAINT database_connection_credential_username_not_null NOT NULL,
    encrypted_password text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at_time public.d_start_created_modified_at_time NOT NULL,
    modified_at_time public.d_start_created_modified_at_time NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_database_connection_credential_encrypted_password CHECK ((encrypted_password ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_database_connection_credential_host_name CHECK ((encrypted_host_name ~ '^(?=.*[[:alnum:]])[[:alnum:][:punct:]]+$'::text)),
    CONSTRAINT chk_database_connection_credential_port_allowed_range CHECK (((port >= 1) AND (port <= 65535))),
    CONSTRAINT chk_database_connection_credential_username CHECK ((encrypted_username ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.database_connection_credential OWNER TO app_superuser;

ALTER TABLE public.database_connection_credential ALTER COLUMN database_connection_credential_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.database_connection_credentia_database_connection_credentia_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.dbms (
    dbms_code character(3) NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_dbms_dbms_code CHECK ((dbms_code ~ '^[[:alnum:]]{3}$'::text)),
    CONSTRAINT chk_dbms_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_dbms_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alnum:] ]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.dbms OWNER TO app_superuser;

CREATE TABLE public.dbms_version (
    dbms_version_id integer NOT NULL,
    dbms_code character(3) NOT NULL,
    version character varying(50) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_dbms_version_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_dbms_version_version CHECK (((version)::text ~ '^(?=.*[[:alnum:]])[[:alnum:][:punct:][:space:]]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.dbms_version OWNER TO app_superuser;

ALTER TABLE public.dbms_version ALTER COLUMN dbms_version_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.dbms_version_dbms_version_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.llm_api_detailed WITH (security_barrier='true') AS
 SELECT lm.llm_id,
    api.llm_api_id,
    lm.model_name AS llm_name,
    lm.is_active AS is_active_llm,
    api.encrypted_api_key,
    api.encrypted_request_url,
    api.token_limit_per_minute,
    api.request_limit_per_minute,
    api.request_limit_per_day
   FROM (public.llm lm
     LEFT JOIN public.llm_api api USING (llm_id));

ALTER VIEW public.llm_api_detailed OWNER TO app_superuser;

COMMENT ON VIEW public.llm_api_detailed IS 'The view retrieves API information about all language models in the system.';

ALTER TABLE public.llm_api ALTER COLUMN llm_api_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.llm_api_llm_api_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.llm_detailed WITH (security_barrier='true') AS
 SELECT lm.llm_id,
    lm.llm_group_id,
    lm.model_name AS llm_name,
    lg.name AS llm_group_name,
    lg.is_active AS llm_group_is_active,
    c.name AS model_company_name,
    c.is_active AS model_company_is_active,
    co.name AS model_company_country,
    co.is_active AS model_company_country_is_active,
    lm.version AS llm_version,
    lm.context_length AS llm_context_length,
    lm.max_output_tokens AS llm_max_output_tokens,
    lm.other_parameters AS llm_other_parameters,
    lm.release_date AS llm_release_date,
    lm.is_local AS is_local_llm,
    lm.is_active AS is_active_llm,
    lm.created_at_time AS llm_created_at,
    u.email AS llm_creator_email,
    lm.modified_at_time AS llm_last_modified_at,
    u2.email AS llm_last_modifier_email,
    ( SELECT string_agg((l.name)::text, ', '::text ORDER BY (l.name)::text) AS string_agg
           FROM (public.llm_supported_language sl
             LEFT JOIN public.language l USING (language_code))
          WHERE ((sl.llm_id = lm.llm_id) AND (l.is_active = true))) AS llm_supported_languages,
    ( SELECT string_agg(((m.name)::text ||
                CASE
                    WHEN sm.is_input THEN ' (input)'::text
                    ELSE ' (output)'::text
                END), ', '::text ORDER BY m.name) AS string_agg
           FROM (public.llm_supported_modality sm
             LEFT JOIN public.modality m USING (modality_code))
          WHERE ((sm.llm_id = lm.llm_id) AND (m.is_active = true))) AS llm_supported_modalities
   FROM (((((public.llm lm
     LEFT JOIN public.llm_group lg USING (llm_group_id))
     LEFT JOIN public.company c USING (company_code))
     LEFT JOIN public.country co USING (country_code))
     LEFT JOIN public.app_user u ON ((lm.creator = u.app_user_id)))
     LEFT JOIN public.app_user u2 ON ((lm.modifier = u2.app_user_id)));

ALTER VIEW public.llm_detailed OWNER TO app_superuser;

COMMENT ON VIEW public.llm_detailed IS 'The view retrieves detailed information (various parameters, creation time and creator, supported languages, and more) about all language models added to the system.';

CREATE VIEW public.llm_group_active WITH (security_barrier='true') AS
 SELECT mg.llm_group_id,
    mg.name AS llm_group_name,
    e.name AS llm_group_company
   FROM (public.llm_group mg
     LEFT JOIN public.company e USING (company_code))
  WHERE ((mg.is_active = true) AND (e.is_active = true));

ALTER VIEW public.llm_group_active OWNER TO app_superuser;

COMMENT ON VIEW public.llm_group_active IS 'The view retrieves data about all active language model groups from the classifier table LLM_group. The internal group ID, group name, and the company responsible for the model group are returned.';

ALTER TABLE public.llm_group ALTER COLUMN llm_group_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.llm_group_llm_group_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

ALTER TABLE public.llm ALTER COLUMN llm_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.llm_llm_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.llm_price_detailed WITH (security_barrier='true') AS
 SELECT lm.llm_id,
    lp.llm_price_id,
    lm.model_name AS llm_name,
    lm.is_active AS is_active_llm,
    lp.price_per_unit AS llm_price_per_unit,
    lp.unit_size AS llm_unit_size,
    lp.min_unit_size AS llm_min_unit_size,
    lp.max_unit_size AS llm_max_unit_size,
    lp.currency_code AS currency,
    m.name AS modality_name,
    lp.is_input,
    lp.is_batch,
    lp.valid_from_time AS price_valid_from,
    lp.valid_until_time AS price_valid_until
   FROM ((((public.llm lm
     LEFT JOIN public.llm_price lp USING (llm_id))
     LEFT JOIN public.llm_price_modality pm USING (llm_price_id))
     LEFT JOIN public.llm_supported_modality sm USING (llm_supported_modality_id))
     LEFT JOIN public.modality m USING (modality_code));

ALTER VIEW public.llm_price_detailed OWNER TO app_superuser;

COMMENT ON VIEW public.llm_price_detailed IS 'The view retrieves price information about all language models in the system.';

ALTER TABLE public.llm_price ALTER COLUMN llm_price_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.llm_price_llm_price_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.llm_supported_language_detailed WITH (security_barrier='true') AS
 SELECT lm.llm_id,
    lm.model_name AS llm_name,
    lm.is_active AS is_active_llm,
    sl.language_code,
    l.name AS language_name
   FROM ((public.llm lm
     LEFT JOIN public.llm_supported_language sl USING (llm_id))
     LEFT JOIN public.language l USING (language_code));

ALTER VIEW public.llm_supported_language_detailed OWNER TO app_superuser;

COMMENT ON VIEW public.llm_supported_language_detailed IS 'The view retrieves information about supported languages for all language models in the system.';

CREATE VIEW public.llm_supported_modality_detailed WITH (security_barrier='true') AS
 SELECT lm.llm_id,
    lm.model_name AS llm_name,
    lm.is_active AS is_active_llm,
    sm.modality_code,
    m.name AS modality_name,
    sm.is_input
   FROM ((public.llm lm
     LEFT JOIN public.llm_supported_modality sm USING (llm_id))
     LEFT JOIN public.modality m USING (modality_code));

ALTER VIEW public.llm_supported_modality_detailed OWNER TO app_superuser;

COMMENT ON VIEW public.llm_supported_modality_detailed IS 'The view retrieves information about supported modalities for all language models in the system.';

ALTER TABLE public.llm_supported_modality ALTER COLUMN llm_supported_modality_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.llm_supported_modality_llm_supported_modality_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.message (
    message_id bigint NOT NULL,
    chat_id bigint NOT NULL,
    parent_message_id bigint,
    used_llm_id bigint NOT NULL,
    encrypted_content text CONSTRAINT message_content_not_null NOT NULL,
    sent_time public.d_start_created_modified_at_time NOT NULL,
    is_sent_by_user boolean DEFAULT true NOT NULL,
    is_flagged_by_user boolean DEFAULT false NOT NULL,
    CONSTRAINT chk_message_content CHECK ((char_length(TRIM(BOTH FROM encrypted_content)) > 0)),
    CONSTRAINT chk_message_parent_cannot_be_same_message CHECK ((message_id <> parent_message_id))
)
WITH (fillfactor='90');

ALTER TABLE public.message OWNER TO app_superuser;

ALTER TABLE public.message ALTER COLUMN message_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.message_message_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE VIEW public.nonactive_llm_detailed WITH (security_barrier='true') AS
 SELECT lm.llm_id,
    lm.llm_group_id,
    lm.model_name AS llm_name,
    lg.name AS llm_group_name,
    lg.is_active AS llm_group_is_active,
    c.name AS model_company_name,
    c.is_active AS model_company_is_active,
    co.name AS model_company_country,
    co.is_active AS model_company_country_is_active,
    lm.version AS llm_version,
    lm.context_length AS llm_context_length,
    lm.max_output_tokens AS llm_max_output_tokens,
    lm.other_parameters AS llm_other_parameters,
    lm.release_date AS llm_release_date,
    lm.is_local AS is_local_llm,
    lm.is_active AS is_active_llm,
    lm.created_at_time AS llm_created_at,
    u.email AS llm_creator_email,
    lm.modified_at_time AS llm_last_modified_at,
    u2.email AS llm_last_modifier_email,
    ( SELECT string_agg((l.name)::text, ', '::text ORDER BY (l.name)::text) AS string_agg
           FROM (public.llm_supported_language sl
             LEFT JOIN public.language l USING (language_code))
          WHERE ((sl.llm_id = lm.llm_id) AND (l.is_active = true))) AS llm_supported_languages,
    ( SELECT string_agg(((m.name)::text ||
                CASE
                    WHEN sm.is_input THEN ' (input)'::text
                    ELSE ' (output)'::text
                END), ', '::text ORDER BY m.name) AS string_agg
           FROM (public.llm_supported_modality sm
             LEFT JOIN public.modality m USING (modality_code))
          WHERE ((sm.llm_id = lm.llm_id) AND (m.is_active = true))) AS llm_supported_modalities
   FROM (((((public.llm lm
     LEFT JOIN public.llm_group lg USING (llm_group_id))
     LEFT JOIN public.company c USING (company_code))
     LEFT JOIN public.country co USING (country_code))
     LEFT JOIN public.app_user u ON ((lm.creator = u.app_user_id)))
     LEFT JOIN public.app_user u2 ON ((lm.modifier = u2.app_user_id)))
  WHERE (lm.is_active = false);

ALTER VIEW public.nonactive_llm_detailed OWNER TO app_superuser;

COMMENT ON VIEW public.nonactive_llm_detailed IS 'The view retrieves detailed information about all language models in the system that have an inactive status.';

CREATE VIEW public.resource_hierarchy_detailed WITH (security_barrier='true', security_invoker='false') AS
 SELECT r.resource_id,
    'DATABASE'::text AS resource_level,
    rd.name AS resource_name,
    rd.database_id,
    NULL::bigint AS schema_id,
    NULL::bigint AS table_id,
    NULL::bigint AS column_id,
    rd.name AS database_name,
    NULL::character varying(100) AS schema_name,
    NULL::character varying(100) AS table_name,
    NULL::character varying(100) AS column_name,
    r.description_for_llm,
    r.comment_for_user,
    r.is_active,
    r.created_at_time,
    r.modified_at_time
   FROM (public.resource r
     JOIN public.resource_database rd ON ((rd.database_id = r.resource_id)))
UNION ALL
 SELECT r.resource_id,
    'SCHEMA'::text AS resource_level,
    rs.name AS resource_name,
    rs.database_id,
    rs.schema_id,
    NULL::bigint AS table_id,
    NULL::bigint AS column_id,
    rd.name AS database_name,
    rs.name AS schema_name,
    NULL::character varying(100) AS table_name,
    NULL::character varying(100) AS column_name,
    r.description_for_llm,
    r.comment_for_user,
    r.is_active,
    r.created_at_time,
    r.modified_at_time
   FROM ((public.resource r
     JOIN public.resource_schema rs ON ((rs.schema_id = r.resource_id)))
     JOIN public.resource_database rd ON ((rd.database_id = rs.database_id)))
UNION ALL
 SELECT r.resource_id,
    'TABLE'::text AS resource_level,
    rt.name AS resource_name,
    rs.database_id,
    rt.schema_id,
    rt.table_id,
    NULL::bigint AS column_id,
    rd.name AS database_name,
    rs.name AS schema_name,
    rt.name AS table_name,
    NULL::character varying(100) AS column_name,
    r.description_for_llm,
    r.comment_for_user,
    r.is_active,
    r.created_at_time,
    r.modified_at_time
   FROM (((public.resource r
     JOIN public.resource_table rt ON ((rt.table_id = r.resource_id)))
     JOIN public.resource_schema rs ON ((rs.schema_id = rt.schema_id)))
     JOIN public.resource_database rd ON ((rd.database_id = rs.database_id)))
UNION ALL
 SELECT r.resource_id,
    'COLUMN'::text AS resource_level,
    rc.name AS resource_name,
    rs.database_id,
    rt.schema_id,
    rc.table_id,
    rc.column_id,
    rd.name AS database_name,
    rs.name AS schema_name,
    rt.name AS table_name,
    rc.name AS column_name,
    r.description_for_llm,
    r.comment_for_user,
    r.is_active,
    r.created_at_time,
    r.modified_at_time
   FROM ((((public.resource r
     JOIN public.resource_column rc ON ((rc.column_id = r.resource_id)))
     JOIN public.resource_table rt ON ((rt.table_id = rc.table_id)))
     JOIN public.resource_schema rs ON ((rs.schema_id = rt.schema_id)))
     JOIN public.resource_database rd ON ((rd.database_id = rs.database_id)));

ALTER VIEW public.resource_hierarchy_detailed OWNER TO app_superuser;

COMMENT ON VIEW public.resource_hierarchy_detailed IS 'Flattens the resource hierarchy into one readable view covering databases, schemas, tables and columns.';

ALTER TABLE public.resource ALTER COLUMN resource_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.resource_resource_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.result_type (
    result_type_code character(10) NOT NULL,
    name character varying(30) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_result_type_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_result_type_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alpha:] ]+$'::text)),
    CONSTRAINT chk_result_type_result_type_code CHECK ((result_type_code ~ '^(?=.*[[:alnum:]])[[:alnum:] ]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.result_type OWNER TO app_superuser;

CREATE TABLE public.sql_query (
    sql_query_id bigint NOT NULL,
    chat_id bigint NOT NULL,
    trigger_message_id bigint NOT NULL,
    result_type_code character(10) NOT NULL,
    query character varying(20000) NOT NULL,
    is_successful boolean DEFAULT true NOT NULL,
    execution_time_ms public.d_nonnegative_int,
    result_row_count public.d_nonnegative_int,
    error_message character varying(10000),
    created_at_time public.d_start_created_modified_at_time NOT NULL,
    CONSTRAINT chk_sql_query_error_message CHECK ((char_length(TRIM(BOTH FROM error_message)) > 0)),
    CONSTRAINT chk_sql_query_query_not_empty CHECK ((char_length(TRIM(BOTH FROM query)) > 0))
)
WITH (fillfactor='90');

ALTER TABLE public.sql_query OWNER TO app_superuser;

CREATE TABLE public.sql_query_resource_usage (
    resource_id bigint NOT NULL,
    sql_query_id bigint NOT NULL
);

ALTER TABLE public.sql_query_resource_usage OWNER TO app_superuser;

ALTER TABLE public.sql_query ALTER COLUMN sql_query_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sql_query_sql_query_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.table_type (
    table_type_id smallint NOT NULL,
    name character varying(50) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_table_type_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_table_type_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.table_type OWNER TO app_superuser;

ALTER TABLE public.table_type ALTER COLUMN table_type_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.table_type_table_type_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.unit_type (
    unit_type_code character(3) NOT NULL,
    name character varying(50) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_unit_type_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_unit_type_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alpha:] ]+$'::text)),
    CONSTRAINT chk_unit_type_unit_type_code CHECK ((unit_type_code ~ '^[A-Z]{3}$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.unit_type OWNER TO app_superuser;

CREATE TABLE public.user_group (
    user_group_code character(5) NOT NULL,
    name character varying(50) NOT NULL,
    description character varying(1000),
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT chk_user_group_description CHECK (((description)::text ~ '^(?=.*[[:alpha:]])[[:alnum:][:punct:][:space:]]+$'::text)),
    CONSTRAINT chk_user_group_name CHECK (((name)::text ~ '^(?=.*[[:alpha:]])[[:alpha:] ]+$'::text)),
    CONSTRAINT chk_user_group_user_group_code CHECK ((user_group_code ~ '^[A-Z]{5}$'::text))
)
WITH (fillfactor='90');

ALTER TABLE public.user_group OWNER TO app_superuser;

CREATE VIEW public.user_role_active WITH (security_barrier='true') AS
 SELECT user_role_code,
    name AS user_role_name
   FROM public.user_role
  WHERE (is_active = true)
  WITH CASCADED CHECK OPTION;

ALTER VIEW public.user_role_active OWNER TO app_superuser;

COMMENT ON VIEW public.user_role_active IS 'The view retrieves data about all active user roles from the classifier table User_role. The three-letter role code and the role name in Estonian are returned.';

INSERT INTO public.company (company_code, country_code, name, description, is_active) VALUES ('opAI', 'USA', 'OpenAI', NULL, true);
INSERT INTO public.company (company_code, country_code, name, description, is_active) VALUES ('ATHP', 'USA', 'Anthropic', NULL, true);
INSERT INTO public.company (company_code, country_code, name, description, is_active) VALUES ('G DpMd', 'GBR', 'Google DeepMind', NULL, true);

INSERT INTO public.country (country_code, name, description, is_active) VALUES ('AFG', 'Afghanistan', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ALA', 'Åland Islands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ALB', 'Albania', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('DZA', 'Algeria', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ASM', 'American Samoa', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('AND', 'Andorra', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('AGO', 'Angola', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('AIA', 'Anguilla', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ATA', 'Antarctica', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ATG', 'Antigua and Barbuda', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ARG', 'Argentina', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ARM', 'Armenia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ABW', 'Aruba', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('AUS', 'Australia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('AUT', 'Austria', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('AZE', 'Azerbaijan', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BHS', 'Bahamas', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BHR', 'Bahrain', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BGD', 'Bangladesh', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BRB', 'Barbados', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BLR', 'Belarus', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BEL', 'Belgium', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BLZ', 'Belize', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BEN', 'Benin', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BMU', 'Bermuda', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BTN', 'Bhutan', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BOL', 'Bolivia, Plurinational State of', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BIH', 'Bosnia and Herzegovina', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BWA', 'Botswana', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BVT', 'Bouvet Island', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BRA', 'Brazil', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('IOT', 'British Indian Ocean Territory', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BRN', 'Brunei Darussalam', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BGR', 'Bulgaria', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BFA', 'Burkina Faso', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BDI', 'Burundi', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('KHM', 'Cambodia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CMR', 'Cameroon', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CAN', 'Canada', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CPV', 'Cape Verde', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CYM', 'Cayman Islands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CAF', 'Central African Republic', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TCD', 'Chad', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CHL', 'Chile', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CHN', 'China', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CXR', 'Christmas Island', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CCK', 'Cocos (Keeling) Islands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('COL', 'Colombia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('COM', 'Comoros', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('COG', 'Congo', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('COD', 'Congo, the Democratic Republic of the', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('COK', 'Cook Islands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CRI', 'Costa Rica', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CIV', 'Côte d''Ivoire', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('HRV', 'Croatia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CUB', 'Cuba', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CYP', 'Cyprus', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CZE', 'Czech Republic', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('DNK', 'Denmark', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('DJI', 'Djibouti', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('DMA', 'Dominica', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('DOM', 'Dominican Republic', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ECU', 'Ecuador', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('EGY', 'Egypt', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SLV', 'El Salvador', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GNQ', 'Equatorial Guinea', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ERI', 'Eritrea', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ETH', 'Ethiopia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('FLK', 'Falkland Islands (Malvinas)', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('FRO', 'Faroe Islands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('FJI', 'Fiji', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('FRA', 'France', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GUF', 'French Guiana', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PYF', 'French Polynesia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ATF', 'French Southern Territories', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GAB', 'Gabon', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GMB', 'Gambia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GEO', 'Georgia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('DEU', 'Germany', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GHA', 'Ghana', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GIB', 'Gibraltar', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GRC', 'Greece', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GRL', 'Greenland', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GRD', 'Grenada', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GLP', 'Guadeloupe', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GUM', 'Guam', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GTM', 'Guatemala', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GGY', 'Guernsey', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GIN', 'Guinea', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GNB', 'Guinea-Bissau', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GUY', 'Guyana', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('HTI', 'Haiti', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('HMD', 'Heard Island and McDonald Islands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('VAT', 'Holy See (Vatican City State)', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('HND', 'Honduras', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('HKG', 'Hong Kong', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('HUN', 'Hungary', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ISL', 'Iceland', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('IND', 'India', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('IDN', 'Indonesia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('IRN', 'Iran, Islamic Republic of', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('IRQ', 'Iraq', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('IRL', 'Ireland', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('IMN', 'Isle of Man', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ISR', 'Israel', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ITA', 'Italy', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('JAM', 'Jamaica', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('JPN', 'Japan', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('JEY', 'Jersey', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('JOR', 'Jordan', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('KAZ', 'Kazakhstan', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('KEN', 'Kenya', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('KIR', 'Kiribati', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PRK', 'Korea, Democratic People''s Republic of', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('KOR', 'Korea, Republic of', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('KWT', 'Kuwait', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('KGZ', 'Kyrgyzstan', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('LAO', 'Lao People''s Democratic Republic', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('LVA', 'Latvia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('LBN', 'Lebanon', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('LSO', 'Lesotho', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('LBR', 'Liberia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('LBY', 'Libyan Arab Jamahiriya', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('LIE', 'Liechtenstein', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('LTU', 'Lithuania', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('LUX', 'Luxembourg', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MAC', 'Macao', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MKD', 'Macedonia, the former Yugoslav Republic of', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MDG', 'Madagascar', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MWI', 'Malawi', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MYS', 'Malaysia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MDV', 'Maldives', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MLI', 'Mali', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MLT', 'Malta', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MHL', 'Marshall Islands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MTQ', 'Martinique', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MRT', 'Mauritania', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MUS', 'Mauritius', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MYT', 'Mayotte', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MEX', 'Mexico', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('FSM', 'Micronesia, Federated States of', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MDA', 'Moldova, Republic of', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MCO', 'Monaco', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MNG', 'Mongolia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MNE', 'Montenegro', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MSR', 'Montserrat', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MAR', 'Morocco', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MOZ', 'Mozambique', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MMR', 'Myanmar', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('NAM', 'Namibia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('NRU', 'Nauru', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('NPL', 'Nepal', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('NLD', 'Netherlands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ANT', 'Netherlands Antilles', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('NCL', 'New Caledonia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('NZL', 'New Zealand', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('NIC', 'Nicaragua', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('NER', 'Niger', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('NGA', 'Nigeria', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('NIU', 'Niue', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('NFK', 'Norfolk Island', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MNP', 'Northern Mariana Islands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('NOR', 'Norway', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('OMN', 'Oman', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PAK', 'Pakistan', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PLW', 'Palau', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PSE', 'Palestinian Territory, Occupied', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PAN', 'Panama', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PNG', 'Papua New Guinea', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PRY', 'Paraguay', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PER', 'Peru', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PHL', 'Philippines', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PCN', 'Pitcairn', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('POL', 'Poland', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PRT', 'Portugal', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('PRI', 'Puerto Rico', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('QAT', 'Qatar', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('REU', 'Réunion', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ROU', 'Romania', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('RUS', 'Russian Federation', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('RWA', 'Rwanda', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('BLM', 'Saint Barthélemy', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SHN', 'Saint Helena, Ascension and Tristan da Cunha', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('KNA', 'Saint Kitts and Nevis', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('LCA', 'Saint Lucia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('MAF', 'Saint Martin (French part)', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SPM', 'Saint Pierre and Miquelon', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('VCT', 'Saint Vincent and the Grenadines', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('WSM', 'Samoa', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SMR', 'San Marino', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('STP', 'Sao Tome and Principe', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SAU', 'Saudi Arabia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SEN', 'Senegal', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SRB', 'Serbia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SYC', 'Seychelles', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SLE', 'Sierra Leone', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SGP', 'Singapore', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SVK', 'Slovakia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SVN', 'Slovenia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SLB', 'Solomon Islands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SOM', 'Somalia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ZAF', 'South Africa', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SGS', 'South Georgia and the South Sandwich Islands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ESP', 'Spain', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('LKA', 'Sri Lanka', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SDN', 'Sudan', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SUR', 'Suriname', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SJM', 'Svalbard and Jan Mayen', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SWZ', 'Swaziland', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SWE', 'Sweden', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('CHE', 'Switzerland', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('SYR', 'Syrian Arab Republic', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TWN', 'Taiwan, Province of China', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TJK', 'Tajikistan', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TZA', 'Tanzania, United Republic of', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('THA', 'Thailand', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TLS', 'Timor-Leste', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TGO', 'Togo', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TKL', 'Tokelau', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TON', 'Tonga', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TTO', 'Trinidad and Tobago', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TUN', 'Tunisia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TUR', 'Turkey', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TKM', 'Turkmenistan', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TCA', 'Turks and Caicos Islands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('TUV', 'Tuvalu', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('UGA', 'Uganda', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('UKR', 'Ukraine', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ARE', 'United Arab Emirates', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('GBR', 'United Kingdom', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('USA', 'United States', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('UMI', 'United States Minor Outlying Islands', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('URY', 'Uruguay', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('UZB', 'Uzbekistan', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('VUT', 'Vanuatu', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('VEN', 'Venezuela, Bolivarian Republic of', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('VNM', 'Viet Nam', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('VGB', 'Virgin Islands, British', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('VIR', 'Virgin Islands, U.S.', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('WLF', 'Wallis and Futuna', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ESH', 'Western Sahara', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('YEM', 'Yemen', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ZMB', 'Zambia', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('ZWE', 'Zimbabwe', NULL, true);
INSERT INTO public.country (country_code, name, description, is_active) VALUES ('EST', 'Estonia', NULL, true);

INSERT INTO public.currency (currency_code, name, description, is_active) VALUES ('USD', 'United States dollar', NULL, true);
INSERT INTO public.currency (currency_code, name, description, is_active) VALUES ('EUR', 'Euro', NULL, true);
INSERT INTO public.currency (currency_code, name, description, is_active) VALUES ('JPY', 'Japanese yen', NULL, true);
INSERT INTO public.currency (currency_code, name, description, is_active) VALUES ('GBP', 'Pound sterling', NULL, true);
INSERT INTO public.currency (currency_code, name, description, is_active) VALUES ('CHF', 'Swiss franc', NULL, true);
INSERT INTO public.currency (currency_code, name, description, is_active) VALUES ('CAD', 'Canadian dollar', NULL, true);
INSERT INTO public.currency (currency_code, name, description, is_active) VALUES ('AUD', 'Australian dollar', NULL, true);
INSERT INTO public.currency (currency_code, name, description, is_active) VALUES ('SGD', 'Singapore dollar', NULL, true);

INSERT INTO public.dbms (dbms_code, name, description, is_active) VALUES ('PGS', 'PostgreSQL', NULL, true);
INSERT INTO public.dbms (dbms_code, name, description, is_active) VALUES ('ORA', 'Oracle Database', NULL, true);
INSERT INTO public.dbms (dbms_code, name, description, is_active) VALUES ('MYQ', 'MySQL', NULL, true);

INSERT INTO public.modality (modality_code, name, description, is_active) VALUES ('T', 'Text', NULL, true);
INSERT INTO public.modality (modality_code, name, description, is_active) VALUES ('I', 'Image', NULL, true);
INSERT INTO public.modality (modality_code, name, description, is_active) VALUES ('V', 'Video', NULL, true);
INSERT INTO public.modality (modality_code, name, description, is_active) VALUES ('A', 'Audio', NULL, true);

INSERT INTO public.result_type (result_type_code, name, description, is_active) VALUES ('TABULAR', 'Tabular', 'Structured result set returned from SQL.', true);
INSERT INTO public.result_type (result_type_code, name, description, is_active) VALUES ('TEXT', 'Text', 'Human-readable answer generated from query result.', true);
INSERT INTO public.result_type (result_type_code, name, description, is_active) VALUES ('ERROR', 'Error', 'Query execution or answer generation failed.', true);

INSERT INTO public.table_type (table_type_id, name, description, is_active) OVERRIDING SYSTEM VALUE VALUES (1, 'base table', NULL, true);
INSERT INTO public.table_type (table_type_id, name, description, is_active) OVERRIDING SYSTEM VALUE VALUES (2, 'view', NULL, true);
INSERT INTO public.table_type (table_type_id, name, description, is_active) OVERRIDING SYSTEM VALUE VALUES (3, 'materialized view', NULL, true);

INSERT INTO public.unit_type (unit_type_code, name, description, is_active) VALUES ('TOK', 'token', NULL, true);
INSERT INTO public.unit_type (unit_type_code, name, description, is_active) VALUES ('REQ', 'request', NULL, true);
INSERT INTO public.unit_type (unit_type_code, name, description, is_active) VALUES ('WOR', 'word', NULL, true);
INSERT INTO public.unit_type (unit_type_code, name, description, is_active) VALUES ('SEC', 'second', NULL, true);
INSERT INTO public.unit_type (unit_type_code, name, description, is_active) VALUES ('MIN', 'minute', NULL, true);
INSERT INTO public.unit_type (unit_type_code, name, description, is_active) VALUES ('IMG', 'image', NULL, true);
INSERT INTO public.unit_type (unit_type_code, name, description, is_active) VALUES ('COM', 'completion', NULL, true);
INSERT INTO public.unit_type (unit_type_code, name, description, is_active) VALUES ('CHA', 'character', NULL, true);

INSERT INTO public.user_group (user_group_code, name, description, is_active) VALUES ('TESTG', 'testgroup', 'This is a placeholder test group - delete it if not necessary', true);

INSERT INTO public.user_role (user_role_code, name, description, is_active) VALUES ('ADM', 'Administrator', 'Users with this role manage the database and the software.', true);
INSERT INTO public.user_role (user_role_code, name, description, is_active) VALUES ('CHA', 'Chatter', 'Users with this role can use the chat functionality to ask questions.', true);

ALTER TABLE public.database_connection_credential
    ADD CONSTRAINT chk_database_connection_credential_created_before_or_same_modif CHECK (((created_at_time)::timestamp with time zone <= (modified_at_time)::timestamp with time zone)) NOT VALID;

ALTER TABLE ONLY public.access_right
    ADD CONSTRAINT pk_access_right PRIMARY KEY (resource_id, user_group_code);

ALTER TABLE ONLY public.account
    ADD CONSTRAINT pk_account PRIMARY KEY (app_user_id);

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT pk_app_user PRIMARY KEY (app_user_id);

ALTER TABLE ONLY public.app_user_group_member
    ADD CONSTRAINT pk_app_user_group_member PRIMARY KEY (user_group_code, app_user_id);

ALTER TABLE ONLY public.app_user_role_assignment
    ADD CONSTRAINT pk_app_user_role_assignment PRIMARY KEY (user_role_code, app_user_id);

ALTER TABLE ONLY public.chat
    ADD CONSTRAINT pk_chat PRIMARY KEY (chat_id);

ALTER TABLE ONLY public.company
    ADD CONSTRAINT pk_company PRIMARY KEY (company_code);

ALTER TABLE ONLY public.country
    ADD CONSTRAINT pk_country PRIMARY KEY (country_code);

ALTER TABLE ONLY public.currency
    ADD CONSTRAINT pk_currency PRIMARY KEY (currency_code);

ALTER TABLE ONLY public.database_connection_credential
    ADD CONSTRAINT pk_database_connection_credential PRIMARY KEY (database_connection_credential_id);

ALTER TABLE ONLY public.dbms
    ADD CONSTRAINT pk_dbms PRIMARY KEY (dbms_code);

ALTER TABLE ONLY public.dbms_version
    ADD CONSTRAINT pk_dbms_version PRIMARY KEY (dbms_version_id);

ALTER TABLE ONLY public.language
    ADD CONSTRAINT pk_language PRIMARY KEY (language_code);

ALTER TABLE ONLY public.llm
    ADD CONSTRAINT pk_llm PRIMARY KEY (llm_id);

ALTER TABLE ONLY public.llm_api
    ADD CONSTRAINT pk_llm_api PRIMARY KEY (llm_api_id);

ALTER TABLE ONLY public.llm_group
    ADD CONSTRAINT pk_llm_group PRIMARY KEY (llm_group_id);

ALTER TABLE ONLY public.llm_price
    ADD CONSTRAINT pk_llm_price PRIMARY KEY (llm_price_id);

ALTER TABLE ONLY public.llm_price_modality
    ADD CONSTRAINT pk_llm_price_modality PRIMARY KEY (llm_supported_modality_id, llm_price_id);

ALTER TABLE ONLY public.llm_supported_language
    ADD CONSTRAINT pk_llm_supported_language PRIMARY KEY (llm_id, language_code);

ALTER TABLE ONLY public.llm_supported_modality
    ADD CONSTRAINT pk_llm_supported_modality PRIMARY KEY (llm_supported_modality_id);

ALTER TABLE ONLY public.message
    ADD CONSTRAINT pk_message PRIMARY KEY (message_id);

ALTER TABLE ONLY public.modality
    ADD CONSTRAINT pk_modality PRIMARY KEY (modality_code);

ALTER TABLE ONLY public.resource
    ADD CONSTRAINT pk_resource PRIMARY KEY (resource_id);

ALTER TABLE ONLY public.resource_column
    ADD CONSTRAINT pk_resource_column PRIMARY KEY (column_id);

ALTER TABLE ONLY public.resource_database
    ADD CONSTRAINT pk_resource_database PRIMARY KEY (database_id);

ALTER TABLE ONLY public.resource_schema
    ADD CONSTRAINT pk_resource_schema_resource PRIMARY KEY (schema_id);

ALTER TABLE ONLY public.resource_table
    ADD CONSTRAINT pk_resource_table PRIMARY KEY (table_id);

ALTER TABLE ONLY public.result_type
    ADD CONSTRAINT pk_result_type PRIMARY KEY (result_type_code);

ALTER TABLE ONLY public.sql_query
    ADD CONSTRAINT pk_sql_query PRIMARY KEY (sql_query_id);

ALTER TABLE ONLY public.sql_query_resource_usage
    ADD CONSTRAINT pk_sql_query_resource_usage PRIMARY KEY (resource_id, sql_query_id);

ALTER TABLE ONLY public.table_type
    ADD CONSTRAINT pk_table_type PRIMARY KEY (table_type_id);

ALTER TABLE ONLY public.unit_type
    ADD CONSTRAINT pk_unit_type PRIMARY KEY (unit_type_code);

ALTER TABLE ONLY public.user_group
    ADD CONSTRAINT pk_user_group PRIMARY KEY (user_group_code);

ALTER TABLE ONLY public.user_role
    ADD CONSTRAINT pk_user_role PRIMARY KEY (user_role_code);

ALTER TABLE ONLY public.chat
    ADD CONSTRAINT uq_chat_app_user_id_title UNIQUE (app_user_id, chat_title);

ALTER TABLE ONLY public.company
    ADD CONSTRAINT uq_company_name UNIQUE (name);

ALTER TABLE ONLY public.country
    ADD CONSTRAINT uq_country_name UNIQUE (name);

ALTER TABLE ONLY public.currency
    ADD CONSTRAINT uq_currency_name UNIQUE (name);

ALTER TABLE ONLY public.dbms
    ADD CONSTRAINT uq_dbms_name UNIQUE (name);

ALTER TABLE ONLY public.dbms_version
    ADD CONSTRAINT uq_dbms_version_dbms UNIQUE (dbms_code, version);

ALTER TABLE ONLY public.language
    ADD CONSTRAINT uq_language_name UNIQUE (name);

ALTER TABLE ONLY public.llm_api
    ADD CONSTRAINT uq_llm_api_llm_id_api_key UNIQUE (llm_id, encrypted_api_key);

ALTER TABLE ONLY public.llm_group
    ADD CONSTRAINT uq_llm_group_company_code_name UNIQUE (company_code, name);

ALTER TABLE ONLY public.llm
    ADD CONSTRAINT uq_llm_model_name UNIQUE (model_name);

ALTER TABLE ONLY public.llm_supported_modality
    ADD CONSTRAINT uq_llm_supported_modality_modality_llm_input UNIQUE (modality_code, llm_id, is_input);

ALTER TABLE ONLY public.modality
    ADD CONSTRAINT uq_modality_name UNIQUE (name);

ALTER TABLE ONLY public.resource_column
    ADD CONSTRAINT uq_resource_column_name_table UNIQUE (name, table_id);

ALTER TABLE ONLY public.resource_database
    ADD CONSTRAINT uq_resource_database_name UNIQUE (name);

ALTER TABLE ONLY public.resource_schema
    ADD CONSTRAINT uq_resource_schema_name_database UNIQUE (database_id, name);

ALTER TABLE ONLY public.resource_table
    ADD CONSTRAINT uq_resource_table_name_schema UNIQUE (schema_id, name);

ALTER TABLE ONLY public.result_type
    ADD CONSTRAINT uq_result_type_name UNIQUE (name);

ALTER TABLE ONLY public.sql_query
    ADD CONSTRAINT uq_sql_query_time_query UNIQUE (query, created_at_time);

ALTER TABLE ONLY public.table_type
    ADD CONSTRAINT uq_table_type_name UNIQUE (name);

ALTER TABLE ONLY public.unit_type
    ADD CONSTRAINT uq_unit_type_name UNIQUE (name);

ALTER TABLE ONLY public.user_group
    ADD CONSTRAINT uq_user_group_name UNIQUE (name);

ALTER TABLE ONLY public.user_role
    ADD CONSTRAINT uq_user_role_name UNIQUE (name);

CREATE INDEX fki_fk_resource_table_table_type ON public.resource_table USING btree (table_type_id);

CREATE INDEX idx_access_right_user_group_code ON public.access_right USING btree (user_group_code);

CREATE INDEX idx_app_user_creator ON public.app_user USING btree (creator);

CREATE INDEX idx_app_user_group_member_app_user_id ON public.app_user_group_member USING btree (app_user_id);

CREATE INDEX idx_app_user_preferred_llm_language ON public.app_user USING btree (preferred_llm_language);

CREATE INDEX idx_app_user_role_assignment_app_user_id ON public.app_user_role_assignment USING btree (app_user_id);

CREATE INDEX idx_company_country_code ON public.company USING btree (country_code);

CREATE INDEX idx_database_connection_credential_database_id ON public.database_connection_credential USING btree (database_id);

CREATE INDEX idx_database_connection_credential_dbms_version_id ON public.database_connection_credential USING btree (dbms_version_id);

CREATE INDEX idx_llm_creator ON public.llm USING btree (creator);

CREATE INDEX idx_llm_llm_group_id ON public.llm USING btree (llm_group_id);

CREATE INDEX idx_llm_modifier ON public.llm USING btree (modifier);

CREATE INDEX idx_llm_price_currency_code ON public.llm_price USING btree (currency_code);

CREATE INDEX idx_llm_price_llm_id ON public.llm_price USING btree (llm_id);

CREATE INDEX idx_llm_price_modality_llm_price_id ON public.llm_price_modality USING btree (llm_price_id);

CREATE INDEX idx_llm_price_unit_type_code ON public.llm_price USING btree (unit_type_code);

CREATE INDEX idx_llm_supported_language_language_code ON public.llm_supported_language USING btree (language_code);

CREATE INDEX idx_llm_supported_modality_llm_id ON public.llm_supported_modality USING btree (llm_id);

CREATE INDEX idx_message_chat_id ON public.message USING btree (chat_id);

CREATE INDEX idx_message_parent_message_id ON public.message USING btree (parent_message_id);

CREATE INDEX idx_message_used_llm_id ON public.message USING btree (used_llm_id);

CREATE INDEX idx_resource_column_table_id ON public.resource_column USING btree (table_id);

CREATE INDEX idx_resource_creator ON public.resource USING btree (creator);

CREATE INDEX idx_resource_modifier ON public.resource USING btree (modifier);

CREATE INDEX idx_sql_query_chat_id ON public.sql_query USING btree (chat_id);

CREATE INDEX idx_sql_query_resource_usage_sql_query_id ON public.sql_query_resource_usage USING btree (sql_query_id);

CREATE INDEX idx_sql_query_result_type_code ON public.sql_query USING btree (result_type_code);

CREATE INDEX idx_sql_query_trigger_message_id ON public.sql_query USING btree (trigger_message_id);

CREATE UNIQUE INDEX uq_app_user_email ON public.app_user USING btree (upper((email)::text));

CREATE RULE country_active_delete AS
    ON DELETE TO public.country_active DO INSTEAD NOTHING;

COMMENT ON RULE country_active_delete ON public.country_active IS 'Rows could theoretically be deleted through the country_active view, but since deletion through the view is not intended, the operation is disabled.';

CREATE RULE country_active_insert AS
    ON INSERT TO public.country_active DO INSTEAD NOTHING;

COMMENT ON RULE country_active_insert ON public.country_active IS 'Rows could theoretically be inserted through the country_active view, but since insertion through the view is not intended, the operation is disabled.';

CREATE RULE country_active_update AS
    ON UPDATE TO public.country_active DO INSTEAD NOTHING;

COMMENT ON RULE country_active_update ON public.country_active IS 'Rows could theoretically be updated through the country_active view, but since updates through the view are not intended, the operation is disabled.';

CREATE RULE currency_active_delete AS
    ON DELETE TO public.currency_active DO INSTEAD NOTHING;

COMMENT ON RULE currency_active_delete ON public.currency_active IS 'Rows could theoretically be deleted through the currency_active view, but since deletion through the view is not intended, the operation is disabled.';

CREATE RULE currency_active_insert AS
    ON INSERT TO public.currency_active DO INSTEAD NOTHING;

COMMENT ON RULE currency_active_insert ON public.currency_active IS 'Rows could theoretically be inserted through the currency_active view, but since insertion through the view is not intended, the operation is disabled.';

CREATE RULE currency_active_update AS
    ON UPDATE TO public.currency_active DO INSTEAD NOTHING;

COMMENT ON RULE currency_active_update ON public.currency_active IS 'Rows could theoretically be updated through the currency_active view, but since updates through the view are not intended, the operation is disabled.';

CREATE RULE language_active_delete AS
    ON DELETE TO public.language_active DO INSTEAD NOTHING;

COMMENT ON RULE language_active_delete ON public.language_active IS 'Rows could theoretically be deleted through the language_active view, but since deletion through the view is not intended, the operation is disabled.';

CREATE RULE language_active_insert AS
    ON INSERT TO public.language_active DO INSTEAD NOTHING;

COMMENT ON RULE language_active_insert ON public.language_active IS 'Rows could theoretically be inserted through the language_active view, but since insertion through the view is not intended, the operation is disabled.';

CREATE RULE language_active_update AS
    ON UPDATE TO public.language_active DO INSTEAD NOTHING;

COMMENT ON RULE language_active_update ON public.language_active IS 'Rows could theoretically be updated through the language_active view, but since updates through the view are not intended, the operation is disabled.';

CREATE RULE modality_active_delete AS
    ON DELETE TO public.modality_active DO INSTEAD NOTHING;

COMMENT ON RULE modality_active_delete ON public.modality_active IS 'Rows could theoretically be deleted through the modality_active view, but since deletion through the view is not intended, the operation is disabled.';

CREATE RULE modality_active_insert AS
    ON INSERT TO public.modality_active DO INSTEAD NOTHING;

COMMENT ON RULE modality_active_insert ON public.modality_active IS 'Rows could theoretically be inserted through the modality_active view, but since insertion through the view is not intended, the operation is disabled.';

CREATE RULE modality_active_update AS
    ON UPDATE TO public.modality_active DO INSTEAD NOTHING;

COMMENT ON RULE modality_active_update ON public.modality_active IS 'Rows could theoretically be updated through the modality_active view, but since updates through the view are not intended, the operation is disabled.';

CREATE RULE user_role_active_delete AS
    ON DELETE TO public.user_role_active DO INSTEAD NOTHING;

COMMENT ON RULE user_role_active_delete ON public.user_role_active IS 'Rows could theoretically be deleted through the user_role_active view, but since deletion through the view is not intended, the operation is disabled.';

CREATE RULE user_role_active_insert AS
    ON INSERT TO public.user_role_active DO INSTEAD NOTHING;

COMMENT ON RULE user_role_active_insert ON public.user_role_active IS 'Rows could theoretically be inserted through the user_role_active view, but since insertion through the view is not intended, the operation is disabled.';

CREATE RULE user_role_active_update AS
    ON UPDATE TO public.user_role_active DO INSTEAD NOTHING;

COMMENT ON RULE user_role_active_update ON public.user_role_active IS 'Rows could theoretically be updated through the user_role_active view, but since updates through the view are not intended, the operation is disabled.';

CREATE TRIGGER tr_account_automatic_update_modified_at_time BEFORE UPDATE ON public.account FOR EACH ROW WHEN ((old.* IS DISTINCT FROM new.*)) EXECUTE FUNCTION public.f_automatic_update_modified_at_time();

CREATE TRIGGER tr_account_immutable_created_at_time BEFORE UPDATE OF created_at_time ON public.account FOR EACH ROW WHEN (((new.created_at_time)::timestamp with time zone IS DISTINCT FROM (old.created_at_time)::timestamp with time zone)) EXECUTE FUNCTION public.f_immutable_created_at_time();

CREATE TRIGGER tr_app_user_automatic_insert_creator BEFORE INSERT ON public.app_user FOR EACH ROW WHEN ((new.creator IS NULL)) EXECUTE FUNCTION public.f_automatic_insert_creator();

CREATE TRIGGER tr_app_user_automatic_update_modified_at_time BEFORE UPDATE ON public.app_user FOR EACH ROW WHEN ((old.* IS DISTINCT FROM new.*)) EXECUTE FUNCTION public.f_automatic_update_modified_at_time();

CREATE TRIGGER tr_app_user_immutable_created_at_time BEFORE UPDATE OF created_at_time ON public.app_user FOR EACH ROW WHEN (((new.created_at_time)::timestamp with time zone IS DISTINCT FROM (old.created_at_time)::timestamp with time zone)) EXECUTE FUNCTION public.f_immutable_created_at_time();

CREATE TRIGGER tr_app_user_immutable_creator BEFORE UPDATE OF creator ON public.app_user FOR EACH ROW WHEN ((new.creator IS DISTINCT FROM old.creator)) EXECUTE FUNCTION public.f_immutable_creator();

CREATE TRIGGER tr_chat_automatic_update_modified_at_time BEFORE UPDATE ON public.chat FOR EACH ROW WHEN ((old.* IS DISTINCT FROM new.*)) EXECUTE FUNCTION public.f_automatic_update_modified_at_time();

COMMENT ON TRIGGER tr_chat_automatic_update_modified_at_time ON public.chat IS 'Automatically updates modified_at_time when a chat row changes.';

CREATE TRIGGER tr_db_connection_credential_auto_update_modified_at_time BEFORE UPDATE ON public.database_connection_credential FOR EACH ROW WHEN ((old.* IS DISTINCT FROM new.*)) EXECUTE FUNCTION public.f_automatic_update_modified_at_time();

COMMENT ON TRIGGER tr_db_connection_credential_auto_update_modified_at_time ON public.database_connection_credential IS 'Automatically updates modified_at_time when a database credential row changes.';

CREATE TRIGGER tr_llm_automatic_insert_creator BEFORE INSERT ON public.llm FOR EACH ROW WHEN ((new.creator IS NULL)) EXECUTE FUNCTION public.f_automatic_insert_creator();

CREATE TRIGGER tr_llm_automatic_update_modified_at_time BEFORE UPDATE ON public.llm FOR EACH ROW WHEN ((old.* IS DISTINCT FROM new.*)) EXECUTE FUNCTION public.f_automatic_update_modified_at_time();

CREATE TRIGGER tr_llm_automatic_update_modifier BEFORE UPDATE ON public.llm FOR EACH ROW WHEN ((old.* IS DISTINCT FROM new.*)) EXECUTE FUNCTION public.f_automatic_update_modifier();

CREATE TRIGGER tr_llm_delete_active_forbidden BEFORE DELETE ON public.llm FOR EACH ROW WHEN ((old.is_active = true)) EXECUTE FUNCTION public.f_delete_active_llm_forbidden();

CREATE TRIGGER tr_llm_immutable_created_at_time BEFORE UPDATE OF created_at_time ON public.llm FOR EACH ROW WHEN (((new.created_at_time)::timestamp with time zone IS DISTINCT FROM (old.created_at_time)::timestamp with time zone)) EXECUTE FUNCTION public.f_immutable_created_at_time();

CREATE TRIGGER tr_llm_immutable_creator BEFORE UPDATE OF creator ON public.llm FOR EACH ROW WHEN ((new.creator IS DISTINCT FROM old.creator)) EXECUTE FUNCTION public.f_immutable_creator();

CREATE TRIGGER tr_resource_automatic_insert_creator BEFORE INSERT ON public.resource FOR EACH ROW WHEN ((new.creator IS NULL)) EXECUTE FUNCTION public.f_automatic_insert_creator();

CREATE TRIGGER tr_resource_automatic_update_modified_at_time BEFORE UPDATE ON public.resource FOR EACH ROW WHEN ((old.* IS DISTINCT FROM new.*)) EXECUTE FUNCTION public.f_automatic_update_modified_at_time();

CREATE TRIGGER tr_resource_automatic_update_modifier BEFORE UPDATE ON public.resource FOR EACH ROW WHEN ((old.* IS DISTINCT FROM new.*)) EXECUTE FUNCTION public.f_automatic_update_modifier();

CREATE TRIGGER tr_resource_immutable_created_at_time BEFORE UPDATE OF created_at_time ON public.resource FOR EACH ROW WHEN (((new.created_at_time)::timestamp with time zone IS DISTINCT FROM (old.created_at_time)::timestamp with time zone)) EXECUTE FUNCTION public.f_immutable_created_at_time();

CREATE TRIGGER tr_resource_immutable_creator BEFORE UPDATE OF creator ON public.resource FOR EACH ROW WHEN ((new.creator IS DISTINCT FROM old.creator)) EXECUTE FUNCTION public.f_immutable_creator();

CREATE TRIGGER trg_account_hash_password_hash BEFORE INSERT OR UPDATE OF password_hash ON public.account FOR EACH ROW EXECUTE FUNCTION public.account_hash_password_hash();

ALTER TABLE ONLY public.access_right
    ADD CONSTRAINT fk_access_right_resource FOREIGN KEY (resource_id) REFERENCES public.resource(resource_id);

ALTER TABLE ONLY public.access_right
    ADD CONSTRAINT fk_access_right_user_group FOREIGN KEY (user_group_code) REFERENCES public.user_group(user_group_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.account
    ADD CONSTRAINT fk_account_system_user FOREIGN KEY (app_user_id) REFERENCES public.app_user(app_user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT fk_app_user_creator FOREIGN KEY (creator) REFERENCES public.app_user(app_user_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.app_user_group_member
    ADD CONSTRAINT fk_app_user_group_member_user FOREIGN KEY (app_user_id) REFERENCES public.app_user(app_user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_user_group_member
    ADD CONSTRAINT fk_app_user_group_member_user_group FOREIGN KEY (user_group_code) REFERENCES public.user_group(user_group_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.app_user
    ADD CONSTRAINT fk_app_user_preferred_llm_language FOREIGN KEY (preferred_llm_language) REFERENCES public.language(language_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.app_user_role_assignment
    ADD CONSTRAINT fk_app_user_role_assignment_user FOREIGN KEY (app_user_id) REFERENCES public.app_user(app_user_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.app_user_role_assignment
    ADD CONSTRAINT fk_app_user_role_assignment_user_role FOREIGN KEY (user_role_code) REFERENCES public.user_role(user_role_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.chat
    ADD CONSTRAINT fk_chat_app_user_id FOREIGN KEY (app_user_id) REFERENCES public.app_user(app_user_id);

ALTER TABLE ONLY public.company
    ADD CONSTRAINT fk_company_country FOREIGN KEY (country_code) REFERENCES public.country(country_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.database_connection_credential
    ADD CONSTRAINT fk_database_connection_credential_database FOREIGN KEY (database_id) REFERENCES public.resource_database(database_id);

ALTER TABLE ONLY public.database_connection_credential
    ADD CONSTRAINT fk_database_connection_credential_dbms_version FOREIGN KEY (dbms_version_id) REFERENCES public.dbms_version(dbms_version_id);

ALTER TABLE ONLY public.dbms_version
    ADD CONSTRAINT fk_dbms_version_dbms FOREIGN KEY (dbms_code) REFERENCES public.dbms(dbms_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.llm_api
    ADD CONSTRAINT fk_llm_api_llm FOREIGN KEY (llm_id) REFERENCES public.llm(llm_id);

ALTER TABLE ONLY public.llm
    ADD CONSTRAINT fk_llm_creator FOREIGN KEY (creator) REFERENCES public.app_user(app_user_id);

ALTER TABLE ONLY public.llm_group
    ADD CONSTRAINT fk_llm_group_company FOREIGN KEY (company_code) REFERENCES public.company(company_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.llm
    ADD CONSTRAINT fk_llm_llm_group FOREIGN KEY (llm_group_id) REFERENCES public.llm_group(llm_group_id);

ALTER TABLE ONLY public.llm
    ADD CONSTRAINT fk_llm_modifier FOREIGN KEY (modifier) REFERENCES public.app_user(app_user_id);

ALTER TABLE ONLY public.llm_price
    ADD CONSTRAINT fk_llm_price_currency FOREIGN KEY (currency_code) REFERENCES public.currency(currency_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.llm_price
    ADD CONSTRAINT fk_llm_price_llm FOREIGN KEY (llm_id) REFERENCES public.llm(llm_id);

ALTER TABLE ONLY public.llm_price_modality
    ADD CONSTRAINT fk_llm_price_modality_llm_price FOREIGN KEY (llm_price_id) REFERENCES public.llm_price(llm_price_id);

ALTER TABLE ONLY public.llm_price_modality
    ADD CONSTRAINT fk_llm_price_modality_llm_supported_modality FOREIGN KEY (llm_supported_modality_id) REFERENCES public.llm_supported_modality(llm_supported_modality_id);

ALTER TABLE ONLY public.llm_price
    ADD CONSTRAINT fk_llm_price_unit_type FOREIGN KEY (unit_type_code) REFERENCES public.unit_type(unit_type_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.llm_supported_language
    ADD CONSTRAINT fk_llm_supported_language_language FOREIGN KEY (language_code) REFERENCES public.language(language_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.llm_supported_language
    ADD CONSTRAINT fk_llm_supported_language_llm FOREIGN KEY (llm_id) REFERENCES public.llm(llm_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.llm_supported_modality
    ADD CONSTRAINT fk_llm_supported_modality_llm FOREIGN KEY (llm_id) REFERENCES public.llm(llm_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.llm_supported_modality
    ADD CONSTRAINT fk_llm_supported_modality_modality FOREIGN KEY (modality_code) REFERENCES public.modality(modality_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.message
    ADD CONSTRAINT fk_message_chat FOREIGN KEY (chat_id) REFERENCES public.chat(chat_id);

ALTER TABLE ONLY public.message
    ADD CONSTRAINT fk_message_parent_message FOREIGN KEY (parent_message_id) REFERENCES public.message(message_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.message
    ADD CONSTRAINT fk_message_used_llm FOREIGN KEY (used_llm_id) REFERENCES public.llm(llm_id);

ALTER TABLE ONLY public.resource_column
    ADD CONSTRAINT fk_resource_column_resource FOREIGN KEY (column_id) REFERENCES public.resource(resource_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource_column
    ADD CONSTRAINT fk_resource_column_table FOREIGN KEY (table_id) REFERENCES public.resource_table(table_id);

ALTER TABLE ONLY public.resource
    ADD CONSTRAINT fk_resource_creator FOREIGN KEY (creator) REFERENCES public.app_user(app_user_id);

ALTER TABLE ONLY public.resource_database
    ADD CONSTRAINT fk_resource_database_resource FOREIGN KEY (database_id) REFERENCES public.resource(resource_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource
    ADD CONSTRAINT fk_resource_modifier FOREIGN KEY (modifier) REFERENCES public.app_user(app_user_id);

ALTER TABLE ONLY public.resource_schema
    ADD CONSTRAINT fk_resource_schema FOREIGN KEY (schema_id) REFERENCES public.resource(resource_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource_schema
    ADD CONSTRAINT fk_resource_schema_database FOREIGN KEY (database_id) REFERENCES public.resource_database(database_id);

ALTER TABLE ONLY public.resource_table
    ADD CONSTRAINT fk_resource_table_resource FOREIGN KEY (table_id) REFERENCES public.resource(resource_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.resource_table
    ADD CONSTRAINT fk_resource_table_schema FOREIGN KEY (schema_id) REFERENCES public.resource_schema(schema_id);

ALTER TABLE ONLY public.resource_table
    ADD CONSTRAINT fk_resource_table_table_type FOREIGN KEY (table_type_id) REFERENCES public.table_type(table_type_id);

ALTER TABLE ONLY public.sql_query
    ADD CONSTRAINT fk_sql_query_chat FOREIGN KEY (chat_id) REFERENCES public.chat(chat_id);

ALTER TABLE ONLY public.sql_query_resource_usage
    ADD CONSTRAINT fk_sql_query_resource_usage_resource FOREIGN KEY (resource_id) REFERENCES public.resource(resource_id);

ALTER TABLE ONLY public.sql_query_resource_usage
    ADD CONSTRAINT fk_sql_query_resource_usage_sql_query FOREIGN KEY (sql_query_id) REFERENCES public.sql_query(sql_query_id);

ALTER TABLE ONLY public.sql_query
    ADD CONSTRAINT fk_sql_query_result_type FOREIGN KEY (result_type_code) REFERENCES public.result_type(result_type_code) ON UPDATE CASCADE;

ALTER TABLE ONLY public.sql_query
    ADD CONSTRAINT fk_sql_query_trigger_message FOREIGN KEY (trigger_message_id) REFERENCES public.message(message_id);

REVOKE CONNECT,TEMPORARY ON DATABASE andmejutt FROM PUBLIC;

REVOKE ALL ON LANGUAGE plpgsql FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbtreekey16_in(cstring) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbtreekey16_out(extensions.gbtreekey16) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbtreekey2_in(cstring) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbtreekey2_out(extensions.gbtreekey2) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbtreekey32_in(cstring) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbtreekey32_out(extensions.gbtreekey32) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbtreekey4_in(cstring) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbtreekey4_out(extensions.gbtreekey4) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbtreekey8_in(cstring) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbtreekey8_out(extensions.gbtreekey8) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbtreekey_var_in(cstring) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbtreekey_var_out(extensions.gbtreekey_var) FROM PUBLIC;

REVOKE ALL ON TYPE public.d_bcrypt_hash FROM PUBLIC;

REVOKE ALL ON TYPE public.d_email_ci FROM PUBLIC;

REVOKE ALL ON TYPE public.d_https_url FROM PUBLIC;

REVOKE ALL ON TYPE public.d_nonnegative_int FROM PUBLIC;

REVOKE ALL ON TYPE public.d_positive_int FROM PUBLIC;

REVOKE ALL ON TYPE public.d_start_created_modified_at_time FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.armor(bytea) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.armor(bytea, text[], text[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.cash_dist(money, money) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.crypt(text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.date_dist(date, date) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.dearmor(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.decrypt(bytea, bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.decrypt_iv(bytea, bytea, bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.digest(bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.digest(text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.encrypt(bytea, bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.encrypt_iv(bytea, bytea, bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.fips_mode() FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.float4_dist(real, real) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.float8_dist(double precision, double precision) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bit_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bit_consistent(internal, bit, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bit_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bit_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bit_same(extensions.gbtreekey_var, extensions.gbtreekey_var, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bit_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bit_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bool_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bool_consistent(internal, boolean, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bool_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bool_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bool_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bool_same(extensions.gbtreekey2, extensions.gbtreekey2, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bool_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bool_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bpchar_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bpchar_consistent(internal, character, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bpchar_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bytea_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bytea_consistent(internal, bytea, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bytea_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bytea_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bytea_same(extensions.gbtreekey_var, extensions.gbtreekey_var, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bytea_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_bytea_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_cash_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_cash_consistent(internal, money, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_cash_distance(internal, money, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_cash_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_cash_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_cash_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_cash_same(extensions.gbtreekey16, extensions.gbtreekey16, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_cash_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_cash_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_date_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_date_consistent(internal, date, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_date_distance(internal, date, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_date_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_date_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_date_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_date_same(extensions.gbtreekey8, extensions.gbtreekey8, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_date_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_date_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_decompress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_enum_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_enum_consistent(internal, anyenum, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_enum_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_enum_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_enum_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_enum_same(extensions.gbtreekey8, extensions.gbtreekey8, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_enum_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_enum_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float4_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float4_consistent(internal, real, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float4_distance(internal, real, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float4_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float4_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float4_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float4_same(extensions.gbtreekey8, extensions.gbtreekey8, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float4_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float4_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float8_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float8_consistent(internal, double precision, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float8_distance(internal, double precision, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float8_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float8_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float8_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float8_same(extensions.gbtreekey16, extensions.gbtreekey16, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float8_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_float8_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_inet_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_inet_consistent(internal, inet, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_inet_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_inet_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_inet_same(extensions.gbtreekey16, extensions.gbtreekey16, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_inet_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_inet_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int2_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int2_consistent(internal, smallint, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int2_distance(internal, smallint, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int2_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int2_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int2_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int2_same(extensions.gbtreekey4, extensions.gbtreekey4, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int2_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int2_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int4_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int4_consistent(internal, integer, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int4_distance(internal, integer, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int4_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int4_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int4_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int4_same(extensions.gbtreekey8, extensions.gbtreekey8, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int4_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int4_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int8_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int8_consistent(internal, bigint, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int8_distance(internal, bigint, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int8_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int8_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int8_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int8_same(extensions.gbtreekey16, extensions.gbtreekey16, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int8_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_int8_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_intv_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_intv_consistent(internal, interval, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_intv_decompress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_intv_distance(internal, interval, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_intv_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_intv_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_intv_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_intv_same(extensions.gbtreekey32, extensions.gbtreekey32, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_intv_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_intv_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad8_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad8_consistent(internal, macaddr8, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad8_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad8_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad8_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad8_same(extensions.gbtreekey16, extensions.gbtreekey16, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad8_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad8_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad_consistent(internal, macaddr, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad_same(extensions.gbtreekey16, extensions.gbtreekey16, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macad_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_macaddr_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_numeric_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_numeric_consistent(internal, numeric, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_numeric_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_numeric_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_numeric_same(extensions.gbtreekey_var, extensions.gbtreekey_var, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_numeric_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_numeric_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_oid_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_oid_consistent(internal, oid, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_oid_distance(internal, oid, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_oid_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_oid_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_oid_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_oid_same(extensions.gbtreekey8, extensions.gbtreekey8, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_oid_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_oid_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_text_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_text_consistent(internal, text, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_text_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_text_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_text_same(extensions.gbtreekey_var, extensions.gbtreekey_var, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_text_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_text_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_time_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_time_consistent(internal, time without time zone, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_time_distance(internal, time without time zone, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_time_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_time_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_time_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_time_same(extensions.gbtreekey16, extensions.gbtreekey16, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_time_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_time_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_timetz_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_timetz_consistent(internal, time with time zone, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_ts_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_ts_consistent(internal, timestamp without time zone, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_ts_distance(internal, timestamp without time zone, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_ts_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_ts_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_ts_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_ts_same(extensions.gbtreekey16, extensions.gbtreekey16, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_ts_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_ts_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_tstz_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_tstz_consistent(internal, timestamp with time zone, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_tstz_distance(internal, timestamp with time zone, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_uuid_compress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_uuid_consistent(internal, uuid, smallint, oid, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_uuid_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_uuid_penalty(internal, internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_uuid_picksplit(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_uuid_same(extensions.gbtreekey32, extensions.gbtreekey32, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_uuid_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_uuid_union(internal, internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_var_decompress(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_var_fetch(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gbt_varbit_sortsupport(internal) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gen_random_bytes(integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gen_random_uuid() FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gen_salt(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gen_salt(text, integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.gist_translate_cmptype_btree(integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.hmac(bytea, bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.hmac(text, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.int2_dist(smallint, smallint) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.int4_dist(integer, integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.int8_dist(bigint, bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.interval_dist(interval, interval) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.oid_dist(oid, oid) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_armor_headers(text, OUT key text, OUT value text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_key_id(bytea) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.postgres_fdw_disconnect(text) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.postgres_fdw_disconnect_all() FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.postgres_fdw_get_connections(check_conn boolean, OUT server_name text, OUT user_name text, OUT valid boolean, OUT used_in_xact boolean, OUT closed boolean, OUT remote_backend_pid integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.postgres_fdw_handler() FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.postgres_fdw_validator(text[], oid) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.time_dist(time without time zone, time without time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.ts_dist(timestamp without time zone, timestamp without time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION extensions.tstz_dist(timestamp with time zone, timestamp with time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.account_hash_password_hash() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_activate_llm(p_llm_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_add_llm(p_model_name character varying, p_llm_group_id integer, p_version character varying, p_context_length public.d_positive_int, p_max_output_tokens public.d_positive_int, p_other_parameters jsonb, p_release_date date, p_is_local boolean, p_is_active boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_add_llm_api(p_llm_id bigint, p_encrypted_api_key text, p_encrypted_request_url text, p_is_active boolean, p_token_limit_per_minute public.d_positive_int, p_request_limit_per_minute public.d_positive_int, p_request_limit_per_day public.d_positive_int) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_add_llm_price_end_time_exists(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_until_time timestamp with time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_add_llm_price_start_time_exists(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_from_time public.d_start_created_modified_at_time) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_add_llm_price_time_exists(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_from_time public.d_start_created_modified_at_time, p_valid_until_time timestamp with time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_add_llm_price_time_missing(p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_add_llm_supported_language(p_language_code character, p_llm_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_add_llm_supported_modality(p_llm_id bigint, p_modality_code character, p_is_input boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_automatic_insert_creator() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_automatic_update_modified_at_time() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_automatic_update_modifier() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_create_chat(p_app_user_id bigint, p_title character varying) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_current_llm_price(p_llm_id bigint, p_is_input boolean, p_is_batch boolean, p_currency_code character, p_unit_type_code character, p_at_time timestamp with time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_deactivate_llm(p_llm_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_delete_active_llm_forbidden() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_has_access(p_app_user_id bigint, p_resource_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_has_select_validate_query(p_query text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_immutable_created_at_time() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_immutable_creator() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_is_active_with_correct_password(p_email public.d_email_ci, p_password text) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_log_sql_query(p_chat_id bigint, p_trigger_message_id bigint, p_result_type_code character, p_query text, p_is_successful boolean, p_execution_time_ms integer, p_result_row_count integer, p_error_message character varying) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_log_sql_query(p_chat_id bigint, p_trigger_message_id bigint, p_result_type_code character, p_query text, p_generated_prompt_context character varying, p_is_successful boolean, p_execution_time_ms integer, p_result_row_count integer, p_error_message character varying) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_remove_llm(p_llm_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_remove_llm_api(p_llm_api_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_remove_llm_price(p_llm_price_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_remove_llm_supported_language(p_llm_id bigint, p_language_code character) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_remove_llm_supported_modality(p_llm_supported_modality_id bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_update_llm(p_llm_id bigint, p_llm_group_id integer, p_model_name character varying, p_version character varying, p_context_length public.d_positive_int, p_max_output_tokens public.d_positive_int, p_other_parameters jsonb, p_release_date date, p_is_local boolean, p_is_active boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_update_llm_api(p_llm_api_id bigint, p_llm_id bigint, p_encrypted_api_key text, p_encrypted_request_url text, p_is_active boolean, p_token_limit_per_minute public.d_positive_int, p_request_limit_per_minute public.d_positive_int, p_request_limit_per_day public.d_positive_int) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_update_llm_api(p_llm_api_id bigint, p_llm_id bigint, p_api_key character varying, p_request_url public.d_https_url, p_is_active boolean, p_token_limit_per_minute public.d_positive_int, p_request_limit_per_minute public.d_positive_int, p_request_limit_per_day public.d_positive_int) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.f_update_llm_price(p_llm_price_id bigint, p_llm_id bigint, p_llm_supported_modality_id bigint, p_currency_code character, p_unit_type_code character, p_price_per_unit numeric, p_unit_size public.d_positive_int, p_min_unit_size public.d_positive_int, p_max_unit_size public.d_positive_int, p_is_batch boolean, p_valid_from_time public.d_start_created_modified_at_time, p_valid_until_time timestamp with time zone) FROM PUBLIC;

REVOKE ALL ON PROCEDURE public.p_register_database_resource(IN p_creator bigint, IN p_modifier bigint, IN p_database_name character varying, IN p_description_for_llm text, IN p_comment_for_user text) FROM PUBLIC;