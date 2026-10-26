# 0021. Registration and login

- Status: Accepted
- Date: 2026-10-26
- Source: round-2 Q18

## Decision
- The **first user to sign up becomes instance admin**. After that, sign-up is **invite-only**: an instance admin invites
  users, and a project invitation to an unknown email also counts as an invite.
- Login methods: email + password always. Google and GitHub OAuth are enabled when their client credentials are present in env config.

## Consequences
- A fresh deployment is claimable by whoever signs up first, so the setup docs must say to sign up right after the first start.
  A `BOOTSTRAP_ADMIN_EMAIL` env var can restrict who that is.
