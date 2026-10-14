"""Tests for the parts of keycloak_login.py that don't need Keycloak running:
pulling the form address off the sign-in page, and the code off the
redirect. Run from the repo root:

    python -m unittest discover -s scripts
"""
import unittest

from keycloak_login import code_from_redirect, login_form_action


class LoginFormAction(unittest.TestCase):
    def test_reads_the_action_and_unescapes_it(self):
        page = ('<form id="kc-form-login" onsubmit="login.disabled = true; return true;" '
                'action="http://localhost:8080/auth/realms/diss/login-actions/authenticate?session_code=abc&amp;tab_id=xyz" '
                'method="post">')
        self.assertEqual(login_form_action(page),
                         "http://localhost:8080/auth/realms/diss/login-actions/authenticate?session_code=abc&tab_id=xyz")

    def test_action_before_id(self):
        page = '<form action="http://kc/login?a=1&amp;b=2" id="kc-form-login" method="post">'
        self.assertEqual(login_form_action(page), "http://kc/login?a=1&b=2")

    def test_ignores_other_forms(self):
        page = '<form id="search" action="/nope"></form><form id="kc-form-login" action="/yes"></form>'
        self.assertEqual(login_form_action(page), "/yes")

    def test_no_login_form_says_so(self):
        with self.assertRaisesRegex(RuntimeError, "No login form"):
            login_form_action("<html><body>We are sorry... Page not found</body></html>")


class CodeFromRedirect(unittest.TestCase):
    def test_reads_the_code(self):
        location = "http://localhost:8080/auth/scripts-callback?state=s&session_state=x&iss=y&code=the-code"
        self.assertEqual(code_from_redirect(location), "the-code")

    def test_error_redirect_gives_keycloaks_reason(self):
        location = "http://localhost:8080/auth/scripts-callback?error=invalid_request&error_description=Missing+parameter"
        with self.assertRaisesRegex(RuntimeError, "Missing parameter"):
            code_from_redirect(location)

    def test_redirect_with_nothing_says_so(self):
        with self.assertRaisesRegex(RuntimeError, "no code in redirect"):
            code_from_redirect("http://localhost:8080/auth/scripts-callback")


if __name__ == "__main__":
    unittest.main()
