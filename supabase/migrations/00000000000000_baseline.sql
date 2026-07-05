


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."get_chart_rankings"("p_chart_id" bigint) RETURNS TABLE("id" bigint, "user_id" bigint, "score" double precision, "typing_speed" double precision, "backspace_count" integer, "created_at" timestamp with time zone, "name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select r.id, r.user_id, r.score, r.typing_speed,
         coalesce(r.backspace_count, 0) as backspace_count,
         r.created_at, u.name
  from (
    select distinct on (user_id)
           id, user_id, score, typing_speed, backspace_count, created_at
    from results
    where chart_id = p_chart_id
    order by user_id, score desc, created_at asc
  ) r
  join users u on u.id = r.user_id
  order by r.score desc, r.created_at asc;
$$;


ALTER FUNCTION "public"."get_chart_rankings"("p_chart_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_result_full"("p_chart_id" integer, "p_user_id" integer, "p_lyric_data" "jsonb", "p_chart_hash" "text", "p_score" numeric, "p_perfect_count" integer, "p_reading_match_count" integer, "p_lost_count" integer, "p_typing_speed" numeric, "p_total_phrases" integer, "p_backspace_count" integer, "p_key_events" "jsonb", "p_commit_events" "jsonb", "p_phrase_results" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_version_id integer;
  v_result_id integer;
  v_version_num integer;
begin
  select id into v_version_id
  from public.chart_versions
  where chart_id = p_chart_id
    and chart_hash = p_chart_hash;

  if not found then
    select coalesce(max(version), 0) + 1 into v_version_num
    from public.chart_versions
    where chart_id = p_chart_id;

    insert into public.chart_versions (chart_id, version, chart_hash, lyric_data)
    values (p_chart_id, v_version_num, p_chart_hash, p_lyric_data)
    returning id into v_version_id;
  end if;

  insert into public.results (
    chart_id,
    chart_version_id,
    user_id,
    score,
    perfect_count,
    reading_match_count,
    lost_count,
    typing_speed,
    total_phrases,
    backspace_count
  )
  values (
    p_chart_id,
    v_version_id,
    p_user_id,
    p_score,
    p_perfect_count,
    p_reading_match_count,
    p_lost_count,
    p_typing_speed,
    p_total_phrases,
    p_backspace_count
  )
  returning id into v_result_id;

  insert into public.replay_data (result_id, key_events, commit_events, phrase_results)
  values (v_result_id, p_key_events, p_commit_events, p_phrase_results);
end;
$$;


ALTER FUNCTION "public"."insert_result_full"("p_chart_id" integer, "p_user_id" integer, "p_lyric_data" "jsonb", "p_chart_hash" "text", "p_score" numeric, "p_perfect_count" integer, "p_reading_match_count" integer, "p_lost_count" integer, "p_typing_speed" numeric, "p_total_phrases" integer, "p_backspace_count" integer, "p_key_events" "jsonb", "p_commit_events" "jsonb", "p_phrase_results" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."chart_versions" (
    "id" integer NOT NULL,
    "chart_id" integer NOT NULL,
    "version" integer NOT NULL,
    "chart_hash" "text" NOT NULL,
    "lyric_data" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."chart_versions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."chart_versions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."chart_versions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."chart_versions_id_seq" OWNED BY "public"."chart_versions"."id";



CREATE TABLE IF NOT EXISTS "public"."charts" (
    "id" integer NOT NULL,
    "uploader_id" integer,
    "title" "text" NOT NULL,
    "artist" "text",
    "description" "text",
    "lrc_raw" "text" NOT NULL,
    "repl_raw" "text" NOT NULL,
    "chart_data" "jsonb" NOT NULL,
    "youtube_video_id" "text",
    "media_source" "text",
    "note_count" integer NOT NULL,
    "duration_seconds" real,
    "phrase_count" integer NOT NULL,
    "status" "text" DEFAULT 'active'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "play_count" integer DEFAULT 0,
    "like_count" integer DEFAULT 0,
    "score_count" integer DEFAULT 0,
    "source" "text" DEFAULT ''::"text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "avg_cpm" integer,
    "peak_cpm" integer,
    "median_cpm" integer DEFAULT 0,
    "peak_start_line_no" integer DEFAULT '-1'::integer,
    "peak_start_line_text" "text",
    "peak_end_line_no" integer DEFAULT '-1'::integer,
    "peak_end_line_text" "text",
    "char_types" "jsonb" DEFAULT '{"digit": 0, "kanji": 0, "english": 0, "hiragana": 0, "katakana": 0}'::"jsonb"
);


ALTER TABLE "public"."charts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."charts_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."charts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."charts_id_seq" OWNED BY "public"."charts"."id";



ALTER TABLE "public"."charts" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."charts_id_seq1"
    START WITH 9
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."handle_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "handle" "text" NOT NULL,
    "profile_id" integer NOT NULL,
    "released_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "handle_key" character varying(20) NOT NULL
);


ALTER TABLE "public"."handle_reservations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."master_repl" (
    "id" bigint NOT NULL,
    "key" "text" NOT NULL,
    "reading" "text" NOT NULL,
    "status" "text" DEFAULT 'verified'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."master_repl" OWNER TO "postgres";


ALTER TABLE "public"."master_repl" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."master_repl_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."replay_data" (
    "id" integer NOT NULL,
    "result_id" integer NOT NULL,
    "key_events" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "commit_events" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "phrase_results" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL
);


ALTER TABLE "public"."replay_data" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."replay_data_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."replay_data_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."replay_data_id_seq" OWNED BY "public"."replay_data"."id";



CREATE TABLE IF NOT EXISTS "public"."results" (
    "id" integer NOT NULL,
    "chart_id" integer NOT NULL,
    "chart_version_id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "score" numeric NOT NULL,
    "perfect_count" integer DEFAULT 0 NOT NULL,
    "reading_match_count" integer DEFAULT 0 NOT NULL,
    "lost_count" integer DEFAULT 0 NOT NULL,
    "typing_speed" numeric DEFAULT 0 NOT NULL,
    "total_phrases" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "backspace_count" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."results" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."results_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."results_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."results_id_seq" OWNED BY "public"."results"."id";



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" integer NOT NULL,
    "auth_id" "text" NOT NULL,
    "handle" character varying(20) NOT NULL,
    "name" character varying(30) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "handle_key" character varying(20) NOT NULL,
    "role" "text" DEFAULT 'user'::"text" NOT NULL,
    CONSTRAINT "users_handle_format" CHECK ((("handle")::"text" ~ '^[A-Za-z0-9_]+$'::"text")),
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE "public"."users" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."users_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."chart_versions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."chart_versions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."replay_data" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."replay_data_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."results" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."results_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."chart_versions"
    ADD CONSTRAINT "chart_versions_chart_id_lyric_hash_key" UNIQUE ("chart_id", "chart_hash");



ALTER TABLE ONLY "public"."chart_versions"
    ADD CONSTRAINT "chart_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."charts"
    ADD CONSTRAINT "charts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."handle_reservations"
    ADD CONSTRAINT "handle_reservations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_repl"
    ADD CONSTRAINT "master_repl_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."master_repl"
    ADD CONSTRAINT "master_repl_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."replay_data"
    ADD CONSTRAINT "replay_data_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."replay_data"
    ADD CONSTRAINT "replay_data_result_id_key" UNIQUE ("result_id");



ALTER TABLE ONLY "public"."results"
    ADD CONSTRAINT "results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_auth_id_key" UNIQUE ("auth_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "charts_uploader_id_idx" ON "public"."charts" USING "btree" ("uploader_id");



CREATE INDEX "handle_reservations_handle_idx" ON "public"."handle_reservations" USING "btree" ("handle");



CREATE INDEX "handle_reservations_handle_key_released_at_idx" ON "public"."handle_reservations" USING "btree" ("handle_key", "released_at");



CREATE INDEX "handle_reservations_profile_id_idx" ON "public"."handle_reservations" USING "btree" ("profile_id");



CREATE INDEX "idx_results_chart_user_score" ON "public"."results" USING "btree" ("chart_id", "user_id", "score" DESC);



CREATE INDEX "master_repl_key_idx" ON "public"."master_repl" USING "btree" ("key");



CREATE INDEX "master_repl_updated_at_idx" ON "public"."master_repl" USING "btree" ("updated_at" DESC);



CREATE INDEX "results_user_id_idx" ON "public"."results" USING "btree" ("user_id");



CREATE INDEX "users_auth_id_idx" ON "public"."users" USING "btree" ("auth_id");



CREATE UNIQUE INDEX "users_handle_key_unique" ON "public"."users" USING "btree" ("handle_key");



CREATE OR REPLACE TRIGGER "master_repl_updated_at" BEFORE UPDATE ON "public"."master_repl" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."chart_versions"
    ADD CONSTRAINT "chart_versions_chart_id_fkey" FOREIGN KEY ("chart_id") REFERENCES "public"."charts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."charts"
    ADD CONSTRAINT "charts_uploader_id_users_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."handle_reservations"
    ADD CONSTRAINT "handle_reservations_profile_id_users_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."replay_data"
    ADD CONSTRAINT "replay_data_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "public"."results"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."results"
    ADD CONSTRAINT "results_chart_id_fkey" FOREIGN KEY ("chart_id") REFERENCES "public"."charts"("id");



ALTER TABLE ONLY "public"."results"
    ADD CONSTRAINT "results_chart_version_id_fkey" FOREIGN KEY ("chart_version_id") REFERENCES "public"."chart_versions"("id");



ALTER TABLE ONLY "public"."results"
    ADD CONSTRAINT "results_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."chart_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."charts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."handle_reservations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."master_repl" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "master_repl_read" ON "public"."master_repl" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."replay_data" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."results" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."get_chart_rankings"("p_chart_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_chart_rankings"("p_chart_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_chart_rankings"("p_chart_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."insert_result_full"("p_chart_id" integer, "p_user_id" integer, "p_lyric_data" "jsonb", "p_chart_hash" "text", "p_score" numeric, "p_perfect_count" integer, "p_reading_match_count" integer, "p_lost_count" integer, "p_typing_speed" numeric, "p_total_phrases" integer, "p_backspace_count" integer, "p_key_events" "jsonb", "p_commit_events" "jsonb", "p_phrase_results" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."insert_result_full"("p_chart_id" integer, "p_user_id" integer, "p_lyric_data" "jsonb", "p_chart_hash" "text", "p_score" numeric, "p_perfect_count" integer, "p_reading_match_count" integer, "p_lost_count" integer, "p_typing_speed" numeric, "p_total_phrases" integer, "p_backspace_count" integer, "p_key_events" "jsonb", "p_commit_events" "jsonb", "p_phrase_results" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."insert_result_full"("p_chart_id" integer, "p_user_id" integer, "p_lyric_data" "jsonb", "p_chart_hash" "text", "p_score" numeric, "p_perfect_count" integer, "p_reading_match_count" integer, "p_lost_count" integer, "p_typing_speed" numeric, "p_total_phrases" integer, "p_backspace_count" integer, "p_key_events" "jsonb", "p_commit_events" "jsonb", "p_phrase_results" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."chart_versions" TO "anon";
GRANT ALL ON TABLE "public"."chart_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."chart_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."chart_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chart_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chart_versions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."charts" TO "anon";
GRANT ALL ON TABLE "public"."charts" TO "authenticated";
GRANT ALL ON TABLE "public"."charts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."charts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."charts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."charts_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."charts_id_seq1" TO "anon";
GRANT ALL ON SEQUENCE "public"."charts_id_seq1" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."charts_id_seq1" TO "service_role";



GRANT ALL ON TABLE "public"."handle_reservations" TO "anon";
GRANT ALL ON TABLE "public"."handle_reservations" TO "authenticated";
GRANT ALL ON TABLE "public"."handle_reservations" TO "service_role";



GRANT ALL ON TABLE "public"."master_repl" TO "anon";
GRANT ALL ON TABLE "public"."master_repl" TO "authenticated";
GRANT ALL ON TABLE "public"."master_repl" TO "service_role";



GRANT ALL ON SEQUENCE "public"."master_repl_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."master_repl_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."master_repl_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."replay_data" TO "anon";
GRANT ALL ON TABLE "public"."replay_data" TO "authenticated";
GRANT ALL ON TABLE "public"."replay_data" TO "service_role";



GRANT ALL ON SEQUENCE "public"."replay_data_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."replay_data_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."replay_data_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."results" TO "anon";
GRANT ALL ON TABLE "public"."results" TO "authenticated";
GRANT ALL ON TABLE "public"."results" TO "service_role";



GRANT ALL ON SEQUENCE "public"."results_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."results_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."results_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON SEQUENCE "public"."users_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."users_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."users_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































