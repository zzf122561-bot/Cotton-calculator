package com.xuesui.cottoncal.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import com.xuesui.cottoncal.model.CottonPreset
import com.xuesui.cottoncal.model.InputField
import com.xuesui.cottoncal.model.PriceBasis
import com.xuesui.cottoncal.state.CalculatorStateReducer
import com.xuesui.cottoncal.state.PresetDefaults
import com.xuesui.cottoncal.ui.theme.CottonCalTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class CottonCalculatorScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun lastEditedPriceBecomesBasisAndDetailsExpand() {
        var currentState = PresetDefaults.state(CottonPreset.HAND_PICKED)
        composeRule.setContent {
            var state by remember { mutableStateOf(currentState) }
            currentState = state
            CottonCalTheme {
                CottonCalculatorScreen(
                    selectedPreset = CottonPreset.HAND_PICKED,
                    state = state,
                    showResetDialog = false,
                    onPresetSelected = {},
                    onValueChanged = { field, value -> state = CalculatorStateReducer.edit(state, field, value) },
                    onToggleDetails = { state = state.copy(detailsExpanded = !state.detailsExpanded) },
                    onRequestReset = {},
                    onCancelReset = {},
                    onConfirmReset = {},
                )
            }
        }

        composeRule.onNodeWithTag(TestTags.LINT_PRICE).performTextReplacement("15000")
        composeRule.onNodeWithTag(TestTags.SEED_PRICE).assertTextContains("7.04")
        composeRule.runOnIdle { assertEquals(PriceBasis.LINT, currentState.basis) }

        composeRule.onNodeWithTag(TestTags.DETAILS_TOGGLE).performClick()
        composeRule.onNodeWithText("最终入库成本").assertIsDisplayed()
    }

    @Test
    fun changingParameterKeepsLintAsBasis() {
        var currentState = PresetDefaults.state(CottonPreset.MACHINE_PICKED)
        composeRule.setContent {
            var state by remember { mutableStateOf(currentState) }
            currentState = state
            CottonCalTheme {
                CottonCalculatorScreen(
                    selectedPreset = CottonPreset.MACHINE_PICKED,
                    state = state,
                    showResetDialog = false,
                    onPresetSelected = {},
                    onValueChanged = { field, value -> state = CalculatorStateReducer.edit(state, field, value) },
                    onToggleDetails = {},
                    onRequestReset = {},
                    onCancelReset = {},
                    onConfirmReset = {},
                )
            }
        }

        composeRule.onNodeWithTag(TestTags.LINT_PRICE).performTextReplacement("17000")
        composeRule.onNodeWithTag(TestTags.field(InputField.PROCESSING_FEE)).performTextReplacement("1200")
        composeRule.runOnIdle {
            assertEquals(PriceBasis.LINT, currentState.basis)
            assertEquals("17000", currentState.lintPrice)
        }
    }

    @Test
    fun invalidPercentDisplaysTargetedMessage() {
        var currentState = PresetDefaults.state(CottonPreset.HAND_PICKED)
        composeRule.setContent {
            var state by remember { mutableStateOf(currentState) }
            currentState = state
            CottonCalTheme {
                CottonCalculatorScreen(
                    selectedPreset = CottonPreset.HAND_PICKED,
                    state = state,
                    showResetDialog = false,
                    onPresetSelected = {},
                    onValueChanged = { field, value -> state = CalculatorStateReducer.edit(state, field, value) },
                    onToggleDetails = {},
                    onRequestReset = {},
                    onCancelReset = {},
                    onConfirmReset = {},
                )
            }
        }

        composeRule.onNodeWithTag(TestTags.field(InputField.LINT_PERCENTAGE)).performTextReplacement("0")
        composeRule.onNodeWithText("衣分率必须大于0且不超过100%").assertIsDisplayed()
    }

    @Test
    fun resetRequiresConfirmation() {
        composeRule.setContent {
            CottonCalTheme {
                CottonCalculatorScreen(
                    selectedPreset = CottonPreset.MACHINE_PICKED,
                    state = PresetDefaults.state(CottonPreset.MACHINE_PICKED),
                    showResetDialog = true,
                    onPresetSelected = {},
                    onValueChanged = { _, _ -> },
                    onToggleDetails = {},
                    onRequestReset = {},
                    onCancelReset = {},
                    onConfirmReset = {},
                )
            }
        }

        composeRule.onNodeWithText("恢复默认参数？").assertIsDisplayed()
        composeRule.onNodeWithText("这会覆盖当前机采棉的价格、参数和计算方向。").assertIsDisplayed()
        composeRule.onNodeWithText("取消").assertIsDisplayed()
        composeRule.onNodeWithText("恢复默认值").assertIsDisplayed()
    }

    @Test
    fun contactAuthorOpensAuthorDetailsAndQrCode() {
        composeRule.setContent {
            CottonCalTheme {
                CottonCalculatorScreen(
                    selectedPreset = CottonPreset.HAND_PICKED,
                    state = PresetDefaults.state(CottonPreset.HAND_PICKED),
                    showResetDialog = false,
                    onPresetSelected = {},
                    onValueChanged = { _, _ -> },
                    onToggleDetails = {},
                    onRequestReset = {},
                    onCancelReset = {},
                    onConfirmReset = {},
                )
            }
        }

        composeRule.onNodeWithTag(TestTags.CONTACT_AUTHOR).performClick()
        composeRule.onNodeWithText("厦门建发 · 赵泽帆").assertIsDisplayed()
        composeRule.onNodeWithText("13212730826").assertIsDisplayed()
        composeRule.onNodeWithText("zzf8640283@126.com").assertIsDisplayed()
        composeRule.onNodeWithTag(TestTags.AUTHOR_QR_CODE).assertIsDisplayed()
    }
}
