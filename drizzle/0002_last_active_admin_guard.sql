-- Protect the final active administrator at the persistence boundary.
-- The session-level API of Better Auth must not be trusted to enforce this
-- invariant across every possible endpoint and concurrent administrative request.
CREATE OR REPLACE FUNCTION prevent_last_active_admin_removal()
RETURNS trigger AS $function$
DECLARE
  was_active boolean;
  will_be_active boolean;
  remaining_count integer;
BEGIN
  was_active := NOT COALESCE(OLD.banned, false)
    AND ('admin' = ANY(string_to_array(COALESCE(OLD.role, ''), ',')));

  IF TG_OP = 'DELETE' THEN
    will_be_active := false;
  ELSE
    will_be_active := NOT COALESCE(NEW.banned, false)
      AND ('admin' = ANY(string_to_array(COALESCE(NEW.role, ''), ',')));
  END IF;

  IF was_active AND NOT will_be_active THEN
    -- Serializes role change/ban/delete across distinct user rows.
    PERFORM pg_advisory_xact_lock(9102026);
    SELECT COUNT(*) INTO remaining_count FROM "user"
      WHERE NOT COALESCE(banned, false)
        AND ('admin' = ANY(string_to_array(COALESCE(role, ''), ',')));
    IF remaining_count <= 1 THEN
      RAISE EXCEPTION 'cannot remove the last active administrator'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER protect_last_active_admin
BEFORE UPDATE OF role, banned OR DELETE ON "user"
FOR EACH ROW EXECUTE FUNCTION prevent_last_active_admin_removal();
