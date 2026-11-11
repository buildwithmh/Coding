# MhCoder Professional IDE

A browser-based coding workspace based on the supplied MhCoder editor, with Python, web preview, Java compilation/execution, and a local MySQL database.

## Included capabilities

| Language | Capability | Runtime |
|---|---|---|
| Python | Run code in the browser | Pyodide (network required for initial runtime download) |
| HTML | Sandboxed live preview | Browser |
| CSS | Live preview | Browser |
| JavaScript | Sandboxed preview with captured console output | Browser iframe |
| Java | Compile and run, stdin, stdout/stderr, timeout and output limits | Isolated OpenJDK 17 runner container |
| MySQL | Execute one SQL statement, view result rows and affected rows | MySQL 8.4 container |

The editor also retains its existing file explorer, editor tabs, Python terminal, practice tools, CSV/data tools, and keyboard shortcut bar.

## Quick start (Docker Desktop / Docker Engine)

1. Install Docker Desktop (Windows/macOS) or Docker Engine + Compose (Linux).
2. Copy `.env.example` to `.env`.
3. Replace all four example values with unique random secrets of at least 32 characters. Do not share or commit `.env`.
4. Start the stack from this folder:

   ```bash
   docker compose up --build -d
   ```

5. Open `http://localhost:3000` and sign in using `ADMIN_PASSWORD` from `.env`.
6. Create/open a `.java` file or `.sql` file and press **Run / Execute**.

To generate suitable secrets on macOS/Linux:

```bash
openssl rand -hex 32
```

Generate a different value for each variable. On Windows, use a trusted password manager's random password generator.

## Java example

Create `Main.java`:

```java
import java.util.Scanner;
public class Main {
    public static void main(String[] args) {
        Scanner input = new Scanner(System.in);
        System.out.println("Hello from MhCoder Java runner!");
        if (input.hasNextLine()) System.out.println("You entered: " + input.nextLine());
    }
}
```

Optional stdin is entered in the Java input field beside the Run button. The Java runner uses OpenJDK 17, has an 8-second execution timeout, 128 KB output/source limits, bounded heap/metaspace, temporary per-run directories, and runs in a separate container with no published port, no MySQL-network access, dropped Linux capabilities, a read-only root filesystem, and CPU/memory/process limits.

This is defense-in-depth for a private learning IDE, not a certified hostile-code sandbox. Do not run code from untrusted users or expose it as a public multi-tenant service without a dedicated sandbox platform and security review.

## MySQL example

Create `quick-start.sql` and run each statement separately:

```sql
CREATE TABLE IF NOT EXISTS notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(100) NOT NULL
);
INSERT INTO notes (title) VALUES ('Hello from MhCoder');
SELECT * FROM notes;
```

The database name defaults to `mhcoder`. The SQL service uses a non-root database account, disables multi-statement execution, limits query time to 8 seconds, and caps returned rows at 300. Treat the SQL editor as an administrator's development tool: destructive statements still execute if the database user permits them.

## Security controls included

- Password-protected single-administrator sign-in (password is supplied through environment configuration).
- HttpOnly, SameSite=Strict session cookie; session expires after 8 hours and is invalidated on server restart.
- CSRF token required for execution and logout endpoints.
- Login attempt throttling and timing-safe password comparison.
- Security response headers and a restrictive Content Security Policy baseline.
- Java runner separated from the app and database networks; runner has no published host port.
- Docker resource limits, read-only root filesystems, dropped capabilities, and `no-new-privileges` for app and Java runner.
- MySQL and Java services are not published to the host; app is bound to `127.0.0.1:3000` by default.
- Audit log records sign-ins, sign-outs, Java execution metadata, and SQL query metadata in the `mhcoder_audit` volume. SQL text is truncated in audit records.
- Secrets are read from `.env`; the example file contains placeholders only.

## Backups and operations

- Back up MySQL data using `docker compose exec mysql mysqldump -umhcoder -p mhcoder > mhcoder-backup.sql` (enter the database password when prompted).
- Audit logs are stored in the named volume `mhcoder_audit`.
- View logs: `docker compose logs -f app java-runner mysql`.
- Stop: `docker compose down` (keeps named volumes).
- Remove all database and audit data only when intentionally resetting: `docker compose down -v`.
- Check service status: `curl http://localhost:3000/api/health`.

## Network / HTTPS deployment

By default the app is only published on localhost. This is intentional. For remote iPad access, deploy on a trusted private server and put a maintained HTTPS reverse proxy (for example Caddy or Nginx) in front of the app. Configure TLS, firewall rules, secure backups, secret management, and monitoring before allowing network access. Do not simply change the port binding to `0.0.0.0` and expose the IDE to the internet.

## Multi-user note

This package is configured as a single-administrator private workspace. The editor's project files remain in that browser's local workspace storage. It does not yet implement separate server-side accounts and isolated persistent workspaces for multiple customers. A public hosted product needs a proper user database, per-user workspace storage/authorization, quotas, audit retention policy, hardened job sandboxing, and a security review.

## iPad / phone use

The browser editor can be opened from an iPad when the backend is running on a computer or private server reachable on the same network. The iPad itself does not supply the JDK or MySQL server. For remote access, use HTTPS and proper firewall/authentication configuration.
