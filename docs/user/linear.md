# Linear

Connect a Linear account so you can attach Linear issues to messages.

## Connect an account

1. Open **Settings > Integrations** and find **Linear**.
2. Click **Connect Linear**. Linear's approval page opens in your browser.
3. Choose your workspace and click **Approve**.

The account belongs to the T3 Code server you're connected to, not to one device. Every client
that uses that server (desktop, web, or mobile) can attach issues from it. T3 Code asks for
read-only access.

### Approving from another device

Linear sends your browser back to `http://127.0.0.1:47831/callback` on the machine running the
server. If you approve on a different device, such as a laptop connected to a remote server or
your phone, that page won't load. Copy its full URL from the address bar and paste it into
**Approving from another device?** under the Linear setting.

Sign-in needs port 47831 free on the server machine while you approve.

## Disconnect

Click **Disconnect** under **Settings > Integrations > Linear**. T3 Code revokes its access at
Linear and deletes the stored credential. Issues already attached to messages stay as they were.

If Linear revokes access or the credential expires, the setting shows **Reconnect Linear**.
