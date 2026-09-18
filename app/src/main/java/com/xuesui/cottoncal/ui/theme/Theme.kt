package com.xuesui.cottoncal.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.graphics.Color

private val LightColors = lightColorScheme(
    primary = CottonGreen,
    onPrimary = Color.White,
    primaryContainer = CottonGreenSoft,
    onPrimaryContainer = Ink,
    secondary = SeedBrown,
    onSecondary = Color.White,
    secondaryContainer = SeedBrownSoft,
    onSecondaryContainer = Ink,
    background = FieldMist,
    onBackground = Ink,
    surface = CottonWhite,
    onSurface = Ink,
    surfaceVariant = Color(0xFFE6ECE8),
    onSurfaceVariant = MutedInk,
    outline = Color(0xFF74827A),
    outlineVariant = DividerGreen,
    error = ErrorRed,
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF9ED3B5),
    onPrimary = Color(0xFF003824),
    primaryContainer = Color(0xFF164E39),
    onPrimaryContainer = Color(0xFFD6F5E1),
    secondary = Color(0xFFE9BE94),
    onSecondary = Color(0xFF452B13),
    secondaryContainer = Color(0xFF654424),
    onSecondaryContainer = Color(0xFFFFDCC0),
    background = Color(0xFF101713),
    onBackground = Color(0xFFE2EAE4),
    surface = Color(0xFF161D19),
    onSurface = Color(0xFFE2EAE4),
    surfaceVariant = Color(0xFF37413B),
    onSurfaceVariant = Color(0xFFBBC8C0),
    outline = Color(0xFF859189),
    error = Color(0xFFFFB4AB),
)

@Composable
fun CottonCalTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        typography = Typography(),
        content = content,
    )
}

