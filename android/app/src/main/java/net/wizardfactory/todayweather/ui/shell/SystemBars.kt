package net.wizardfactory.todayweather.ui.shell

import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge

/**
 * The Cordova status bar (`StatusBarBackgroundColor` #111111, config.xml) under light icons: the app draws edge to edge
 * with a transparent status bar of the dark style, and the shell and S01 paint [ShellColors.statusBar] behind it.
 */
fun ComponentActivity.enableShellSystemBars() = enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
