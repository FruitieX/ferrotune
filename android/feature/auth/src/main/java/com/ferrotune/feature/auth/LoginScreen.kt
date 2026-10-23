package com.ferrotune.feature.auth

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ferrotune.core.designsystem.components.FerrotuneLogo
import com.ferrotune.core.model.Account

@Composable
fun LoginScreen(
    onLoggedIn: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var pendingRemoval by remember { mutableStateOf<Account?>(null) }
    val context = LocalContext.current

    // Passkey sign-in happens in a Custom Tab, which shares the browser's
    // provider session, so most sign-ins don't even ask for the passkey.
    LaunchedEffect(state.oidcLaunchUrl) {
        val url = state.oidcLaunchUrl ?: return@LaunchedEffect
        val uri = Uri.parse(url)
        try {
            CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(context, uri)
            viewModel.onOidcLaunched()
        } catch (_: ActivityNotFoundException) {
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                viewModel.onOidcLaunched()
            } catch (_: ActivityNotFoundException) {
                viewModel.onOidcLaunchFailed("No browser available for signing in")
            }
        }
    }

    LaunchedEffect(state.loggedInAccount) {
        if (state.loggedInAccount != null) {
            onLoggedIn()
        }
    }

    pendingRemoval?.let { account ->
        AlertDialog(
            onDismissRequest = { pendingRemoval = null },
            title = { Text("Remove ${account.label}?") },
            text = { Text("This device forgets the account. You can sign in again later.") },
            confirmButton = {
                TextButton(onClick = {
                    pendingRemoval = null
                    viewModel.removeSavedAccount(account)
                }) {
                    Text("Remove", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingRemoval = null }) { Text("Cancel") }
            },
        )
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 448.dp),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            ),
            border = androidx.compose.foundation.BorderStroke(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outline,
            ),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                FerrotuneLogo()
                Spacer(Modifier.height(16.dp))
                Text(
                    text = "Welcome to Ferrotune",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    text = "Sign in to your music server",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(24.dp))

                if (state.savedAccounts.isNotEmpty()) {
                    Text(
                        text = "Saved accounts",
                        style = MaterialTheme.typography.titleSmall,
                        modifier = Modifier.align(Alignment.Start),
                    )
                    Spacer(Modifier.height(8.dp))
                    state.savedAccounts.forEach { account ->
                        SavedAccountRow(
                            account = account,
                            enabled = !state.isConnecting,
                            onSelect = { viewModel.loginWithSavedAccount(account) },
                            onRemove = { pendingRemoval = account },
                        )
                        Spacer(Modifier.height(8.dp))
                    }
                    Spacer(Modifier.height(16.dp))
                }

                OutlinedTextField(
                    value = state.serverUrl,
                    onValueChange = viewModel::onServerUrlChange,
                    label = { Text("Server URL") },
                    placeholder = { Text("http://192.168.1.100:4040") },
                    singleLine = true,
                    leadingIcon = {
                        Icon(Icons.Filled.Dns, contentDescription = null)
                    },
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Uri,
                        imeAction = ImeAction.Next,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                if (state.serverSuggestions.isNotEmpty()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        state.serverSuggestions.forEach { server ->
                            SuggestionChip(
                                onClick = { viewModel.onServerUrlChange(server) },
                                label = { Text(server.substringAfter("://")) },
                                enabled = !state.isConnecting,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(12.dp))

                if (state.oidcAvailable) {
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = viewModel::startPasskeyLogin,
                        enabled = !state.isConnecting,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        if (state.isConnecting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                        } else {
                            Icon(Icons.Filled.Key, contentDescription = null, modifier = Modifier.size(18.dp))
                        }
                        Spacer(Modifier.width(8.dp))
                        Text("Sign in with passkey")
                    }
                    if (!state.showPasswordForm) {
                        Spacer(Modifier.height(4.dp))
                        TextButton(
                            onClick = viewModel::showPasswordForm,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                "Sign in with a password instead",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else {
                        Spacer(Modifier.height(16.dp))
                    }
                }

                if (!state.oidcAvailable || state.showPasswordForm) {
                    OutlinedTextField(
                        value = state.username,
                        onValueChange = viewModel::onUsernameChange,
                        label = { Text("Username") },
                        singleLine = true,
                        leadingIcon = {
                            Icon(Icons.Filled.Person, contentDescription = null)
                        },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(12.dp))

                    OutlinedTextField(
                        value = state.password,
                        onValueChange = viewModel::onPasswordChange,
                        label = { Text("Password") },
                        singleLine = true,
                        leadingIcon = {
                            Icon(Icons.Filled.Lock, contentDescription = null)
                        },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(onDone = { if (!state.isConnecting) viewModel.login() }),
                        modifier = Modifier.fillMaxWidth(),
                    )

                    Spacer(Modifier.height(24.dp))
                    val connectContent: @Composable () -> Unit = {
                        if (state.isConnecting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = if (state.oidcAvailable) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onPrimary
                                },
                            )
                            Spacer(Modifier.width(8.dp))
                        }
                        Text(if (state.isConnecting) "Connecting…" else "Connect")
                    }
                    if (state.oidcAvailable) {
                        OutlinedButton(
                            onClick = viewModel::login,
                            enabled = !state.isConnecting,
                            modifier = Modifier.fillMaxWidth(),
                        ) { connectContent() }
                    } else {
                        Button(
                            onClick = viewModel::login,
                            enabled = !state.isConnecting,
                            modifier = Modifier.fillMaxWidth(),
                        ) { connectContent() }
                    }
                }

                state.error?.let { error ->
                    Spacer(Modifier.height(12.dp))
                    Text(
                        text = error,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun SavedAccountRow(
    account: Account,
    enabled: Boolean,
    onSelect: () -> Unit,
    onRemove: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
        ),
        border = androidx.compose.foundation.BorderStroke(
            width = 1.dp,
            color = MaterialTheme.colorScheme.outline,
        ),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = account.label, style = MaterialTheme.typography.bodyLarge)
                Text(
                    text = account.serverUrl,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onRemove, enabled = enabled) {
                Text("Remove")
            }
            TextButton(onClick = onSelect, enabled = enabled) {
                Text("Use")
            }
        }
    }
}
