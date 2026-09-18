package com.xuesui.cottoncal.state

import com.xuesui.cottoncal.model.CottonPreset
import com.xuesui.cottoncal.model.InputField
import com.xuesui.cottoncal.model.PriceBasis
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CalculatorStateReducerTest {
    @Test
    fun `defaults match displayed Excel totals`() {
        assertEquals("14249", PresetDefaults.state(CottonPreset.HAND_PICKED).lintPrice)
        assertEquals("16987", PresetDefaults.state(CottonPreset.MACHINE_PICKED).lintPrice)
    }

    @Test
    fun `editing lint price switches basis and recalculates seed price`() {
        val initial = PresetDefaults.state(CottonPreset.HAND_PICKED)

        val updated = CalculatorStateReducer.edit(initial, InputField.LINT_PRICE, "15000")

        assertEquals(PriceBasis.LINT, updated.basis)
        assertEquals("15000", updated.lintPrice)
        assertEquals("7.04", updated.seedCottonPrice)
        assertTrue(updated.errors.isEmpty())
    }

    @Test
    fun `editing a parameter keeps the latest price basis`() {
        val lintBased = CalculatorStateReducer.edit(
            PresetDefaults.state(CottonPreset.HAND_PICKED),
            InputField.LINT_PRICE,
            "15000",
        )

        val updated = CalculatorStateReducer.edit(lintBased, InputField.WAREHOUSE_FEE, "200")

        assertEquals(PriceBasis.LINT, updated.basis)
        assertEquals("15000", updated.lintPrice)
        assertNotEquals(lintBased.seedCottonPrice, updated.seedCottonPrice)
    }

    @Test
    fun `focus-equivalent unchanged value does not switch basis`() {
        val initial = PresetDefaults.state(CottonPreset.HAND_PICKED)

        val unchanged = CalculatorStateReducer.edit(initial, InputField.LINT_PRICE, initial.lintPrice)

        assertEquals(PriceBasis.SEED_COTTON, unchanged.basis)
    }

    @Test
    fun `manual seed input is limited to six decimal places`() {
        val initial = PresetDefaults.state(CottonPreset.HAND_PICKED)

        val rejected = CalculatorStateReducer.edit(initial, InputField.SEED_COTTON_PRICE, "6.1234567")
        val accepted = CalculatorStateReducer.edit(initial, InputField.SEED_COTTON_PRICE, "6.123456")

        assertEquals(initial, rejected)
        assertEquals("6.123456", accepted.seedCottonPrice)
    }

    @Test
    fun `blank active input has targeted validation error`() {
        val initial = PresetDefaults.state(CottonPreset.HAND_PICKED)

        val updated = CalculatorStateReducer.edit(initial, InputField.SEED_COTTON_PRICE, "")

        assertEquals(null, updated.result)
        assertTrue(updated.errors.any { it.field == InputField.SEED_COTTON_PRICE })
    }
}

