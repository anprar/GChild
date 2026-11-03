package com.gchild.companion.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val GChildColors = lightColorScheme(
    primary = Color(0xFF1B5E20),
    onPrimary = Color.White,
    secondary = Color(0xFF2E7D32),
    background = Color(0xFFF7F9F7),
    surface = Color.White,
)

@Composable
fun GChildTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = GChildColors,
        typography = Typography(),
        content = content,
    )
}
