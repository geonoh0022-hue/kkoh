from contextlib import closing
from getpass import getpass
import server

if __name__ == '__main__':
    pw = getpass('New teacher password (12-256 characters): ')
    if not 12 <= len(pw) <= 256:
        raise SystemExit('Password must contain 12-256 characters.')
    if pw != getpass('Confirm password: '):
        raise SystemExit('Passwords do not match.')
    with closing(server.connect()) as con, con:
        changed = con.execute("UPDATE config SET value=? WHERE key='password'", (server.password_hash(pw),))
        if changed.rowcount != 1:
            raise SystemExit('Existing database not found. Check DATA_DIR.')
        con.execute("DELETE FROM sessions WHERE role='teacher'")
    print('Teacher password updated.')
