package com.xuesui.cottoncal.state

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.xuesui.cottoncal.model.CottonPreset
import com.xuesui.cottoncal.model.InputField
import com.xuesui.cottoncal.model.PriceBasis
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PresetPreferencesInstrumentedTest {
    private lateinit var context: Context
    private lateinit var preferences: PresetPreferences

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        clearAll()
        preferences = PresetPreferences(context)
    }

    @After
    fun tearDown() = clearAll()

    @Test
    fun twoPresetsPersistIndependentlyWithBasisAndExpansion() {
        val hand = CalculatorStateReducer.edit(
            PresetDefaults.state(CottonPreset.HAND_PICKED),
            InputField.LINT_PRICE,
            "15000",
        ).copy(detailsExpanded = true)
        val machine = CalculatorStateReducer.edit(
            PresetDefaults.state(CottonPreset.MACHINE_PICKED),
            InputField.SEED_COTTON_PRICE,
            "7.8",
        )

        preferences.savePreset(CottonPreset.HAND_PICKED, hand)
        preferences.savePreset(CottonPreset.MACHINE_PICKED, machine)
        preferences.saveSelectedPreset(CottonPreset.MACHINE_PICKED)
        val restored = preferences.loadAppState()

        assertEquals(CottonPreset.MACHINE_PICKED, restored.selectedPreset)
        assertEquals("15000", restored.presets.getValue(CottonPreset.HAND_PICKED).lintPrice)
        assertEquals(PriceBasis.LINT, restored.presets.getValue(CottonPreset.HAND_PICKED).basis)
        assertEquals(true, restored.presets.getValue(CottonPreset.HAND_PICKED).detailsExpanded)
        assertEquals("7.8", restored.presets.getValue(CottonPreset.MACHINE_PICKED).seedCottonPrice)
        assertEquals(PriceBasis.SEED_COTTON, restored.presets.getValue(CottonPreset.MACHINE_PICKED).basis)
    }

    @Test
    fun clearingOnePresetRestoresOnlyThatPresetDefaults() {
        val hand = CalculatorStateReducer.edit(
            PresetDefaults.state(CottonPreset.HAND_PICKED),
            InputField.SEED_COTTON_PRICE,
            "8",
        )
        val machine = CalculatorStateReducer.edit(
            PresetDefaults.state(CottonPreset.MACHINE_PICKED),
            InputField.SEED_COTTON_PRICE,
            "9",
        )
        preferences.savePreset(CottonPreset.HAND_PICKED, hand)
        preferences.savePreset(CottonPreset.MACHINE_PICKED, machine)

        preferences.clearPreset(CottonPreset.HAND_PICKED)
        val restored = preferences.loadAppState()

        assertEquals("6.73832884794535", restored.presets.getValue(CottonPreset.HAND_PICKED).seedCottonPrice)
        assertEquals("9", restored.presets.getValue(CottonPreset.MACHINE_PICKED).seedCottonPrice)
    }

    private fun clearAll() {
        context.getSharedPreferences("cotton_calculator", Context.MODE_PRIVATE).edit().clear().commit()
    }
}
