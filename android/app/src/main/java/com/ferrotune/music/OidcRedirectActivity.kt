package com.ferrotune.music

import androidx.activity.ComponentActivity
import android.content.Intent
import android.os.Bundle
import com.ferrotune.feature.auth.OidcLogin
import com.ferrotune.feature.auth.OidcRedirects
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Receives the end of a passkey sign-in (`ferrotune://oidc/callback?code=…`)
 * from the Custom Tab, hands it to the login screen and returns to
 * [MainActivity], closing the tab above it. A separate trampoline keeps
 * [MainActivity]'s launch mode untouched.
 */
@AndroidEntryPoint
class OidcRedirectActivity : ComponentActivity() {

    @Inject lateinit var redirects: OidcRedirects

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.dataString?.takeIf(OidcLogin::isRedirect)?.let(redirects::deliver)
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }
}
