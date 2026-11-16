# Show password affordance for password input fields

* **Author:** Zia / Orchestrator
* **Date:** 2026-11-13
* **Status:** Decision-ready, after codebase check (EGM Brainstorm Step 3)
* **Target:** Any password input field in Cosmo Ledger Track, with the real scope confirmed against the current codebase.

---

## What the codebase actually contains

I checked the app source for password inputs.

As of today, the only password inputs in the built app are:

- `apps/web/src/routes/(auth)/login/+page.svelte`
- `apps/web/src/routes/(auth)/set-password/+page.svelte`

Both of those already have a show/hide toggle on the password field.

There is no separate reusable password input component in the current app source. The password fields are written directly in those two auth screens.

The auth routes in the app are:

- `(auth)/login`
- `(auth)/set-password`
- `(auth)/callback`

The callback route is an OAuth return path and does not contain a password input.

So the app does not currently match the simplest version of the original complaint. The complaint was "any screen where a password is input has no way to see it." In the current codebase, the two places that actually have password inputs already let the user show the password.

## What that changes

The real issue is narrower than "all password inputs are missing a show control."

Most likely, one of these is true:

1. The user saw one of the existing password screens and the toggle did not work, was hard to notice, was missing in their case, or behaved unexpectedly.
2. The user is thinking of a password input that is planned but not yet built, or is not in the current app code.
3. The user is thinking of a different kind of secret input that looks like a password field but is not a Supabase auth password.
4. The user encountered a flow that the current app does not yet have, such as invite code entry, admin-created credential entry, device PIN, or some other masked input that should behave like a password field.

The decision should still be strict, but it should no longer be based on a false premise.

## Decision

If an input is a password or password-like secret field, it should have a discoverable show/hide control.

That rule still stands. What changed is the scope statement: the app does not currently have a universal absence of show controls on password inputs. The two real password inputs already have one.

So the implementation target is no longer "add a show button to every password field in the app." It is one of these:

- fix the specific password field the user actually found missing the option, if it is one of the existing screens
- add the same control to any password-like input that exists but was missed
- make the show/hide behavior consistent and reusable if the app adds more password inputs later

## Chosen interaction model

The existing login and set-password screens already do the right thing in outline:

- the field is masked by default
- the user can toggle visibility
- the toggle is in the field
- the control says what it does

That is the model to keep and make consistent. If the same password-input behavior is needed elsewhere, it should not be reinvented per screen.

## Constraints that must still hold

- Masked by default.
- Reversible.
- Discoverable.
- Usable on a phone.
- Accessible to more than one input method.
- No default exposure on shared or visible screens.
- No new leakage path created just because the field can be revealed.

## What this is for

This is for any password or password-like secret input in the app. In the current code, that means login password and new-password / confirm-password fields.

If the app later has other password inputs, the same rule should apply.

## What this is not for

- It is not a change to server-side secret handling.
- It is not a decision to make passwords visible by default.
- It is not a redesign of credential delivery or generation.
- It is not a clipboard, logging, screenshot, or broadcasting feature.

## Concrete next action

Before doing any more work, the real target needs to be identified. The two built password fields already have a show option, so the next step is to find the exact input the user means.

The useful question is not "should password fields have a show control?" The useful question is: which password input did you see that had no way to show it?

If you can point to the screen, flow, or device state where you saw the missing option, that is enough to decide whether this is a real bug in an existing screen or a gap in a planned one.

## Open questions

- Which screen or flow showed a password input with no way to show it?
- Was it one of the existing auth screens, or something else?
- Is the user seeing a current app screen, or a screen that has not been built yet?
- Are there any other masked secret inputs in the app besides the two auth password fields?
