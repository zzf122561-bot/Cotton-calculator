package com.xuesui.cottoncal

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.xuesui.cottoncal.state.CalculatorViewModel
import com.xuesui.cottoncal.ui.CottonCalculatorApp
import com.xuesui.cottoncal.ui.theme.CottonCalTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CottonCalTheme {
                val calculatorViewModel: CalculatorViewModel = viewModel()
                CottonCalculatorApp(viewModel = calculatorViewModel)
            }
        }
    }
}

