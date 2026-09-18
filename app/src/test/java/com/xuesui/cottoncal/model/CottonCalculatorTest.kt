package com.xuesui.cottoncal.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigDecimal

class CottonCalculatorTest {
    @Test
    fun `hand-picked Excel example calculates 14249 yuan per ton`() {
        val result = calculateSuccess(handInputs(), PriceBasis.SEED_COTTON)

        assertClose("0.569", result.cottonseedYield)
        assertClose("1.27456", result.cottonseedDeductionPerKg)
        assertClose("13457.5587387816", result.rawLintCostPerTon)
        assertEquals("14249", CottonCalculator.lintDisplay(result.lintPrice))
    }

    @Test
    fun `machine-picked Excel example calculates 16987 yuan per ton`() {
        val result = calculateSuccess(machineInputs(), PriceBasis.SEED_COTTON)

        assertClose("0.49", result.cottonseedYield)
        assertClose("1.225", result.cottonseedDeductionPerKg)
        assertClose("15986.8421052632", result.rawLintCostPerTon)
        assertEquals("16987", CottonCalculator.lintDisplay(result.lintPrice))
    }

    @Test
    fun `reverse calculation reproduces seed price without intermediate rounding`() {
        val forward = calculateSuccess(handInputs(), PriceBasis.SEED_COTTON)
        val reverseInputs = handInputs().copy(lintPrice = forward.lintPrice)

        val reverse = calculateSuccess(reverseInputs, PriceBasis.LINT)

        assertClose(handInputs().seedCottonPrice.toPlainString(), reverse.seedCottonPrice)
    }

    @Test
    fun `fees add and subsidy subtracts`() {
        val input = machineInputs().copy(
            processingFee = BigDecimal("800"),
            laborFee = BigDecimal("20"),
            warehouseFee = BigDecimal("30"),
            financeFee = BigDecimal("40"),
            subsidy = BigDecimal("100"),
        )

        val result = calculateSuccess(input, PriceBasis.SEED_COTTON)

        assertClose("790", result.netFeesPerTon)
        assertClose(result.rawLintCostPerTon.add(BigDecimal("790")).toPlainString(), result.lintPrice)
    }

    @Test
    fun `display precision uses HALF_UP`() {
        assertEquals("6.74", CottonCalculator.seedDisplay(BigDecimal("6.735")))
        assertEquals("14249", CottonCalculator.lintDisplay(BigDecimal("14248.5")))
    }

    @Test
    fun `zero lint percentage is rejected`() {
        val outcome = CottonCalculator.calculate(
            handInputs().copy(lintPercentage = BigDecimal.ZERO),
            PriceBasis.SEED_COTTON,
        )

        assertTrue(outcome is CalculationOutcome.Invalid)
        val errors = (outcome as CalculationOutcome.Invalid).errors
        assertTrue(errors.any { it.field == InputField.LINT_PERCENTAGE })
    }

    @Test
    fun `lint and loss over 100 percent is rejected`() {
        val outcome = CottonCalculator.calculate(
            handInputs().copy(lintPercentage = BigDecimal("60"), lossPercentage = BigDecimal("41")),
            PriceBasis.SEED_COTTON,
        )

        assertTrue(outcome is CalculationOutcome.Invalid)
        val errors = (outcome as CalculationOutcome.Invalid).errors
        assertTrue(errors.any { it.field == InputField.LOSS_PERCENTAGE })
    }

    @Test
    fun `reverse calculation rejects negative seed price`() {
        val outcome = CottonCalculator.calculate(
            handInputs().copy(
                lintPrice = BigDecimal.ZERO,
                cottonseedPrice = BigDecimal.ZERO,
                subsidy = BigDecimal.ZERO,
            ),
            PriceBasis.LINT,
        )

        assertTrue(outcome is CalculationOutcome.Invalid)
        val errors = (outcome as CalculationOutcome.Invalid).errors
        assertTrue(errors.any { it.field == InputField.LINT_PRICE })
    }

    private fun calculateSuccess(inputs: CalculationInputs, basis: PriceBasis): CalculationResult {
        val outcome = CottonCalculator.calculate(inputs, basis)
        assertTrue("Expected success but got $outcome", outcome is CalculationOutcome.Success)
        return (outcome as CalculationOutcome.Success).result
    }

    private fun assertClose(expected: String, actual: BigDecimal) {
        val delta = actual.subtract(BigDecimal(expected)).abs()
        assertTrue("Expected $expected, actual $actual", delta < BigDecimal("0.0000001"))
    }

    private fun handInputs() = CalculationInputs(
        seedCottonPrice = BigDecimal("6.73832884794535"),
        lintPrice = BigDecimal.ZERO,
        lintPercentage = BigDecimal("40.6"),
        lossPercentage = BigDecimal("2.5"),
        cottonseedPrice = BigDecimal("2.24"),
        processingFee = BigDecimal("800"),
        laborFee = BigDecimal.ZERO,
        warehouseFee = BigDecimal("91"),
        financeFee = BigDecimal.ZERO,
        subsidy = BigDecimal("100"),
    )

    private fun machineInputs() = CalculationInputs(
        seedCottonPrice = BigDecimal("7.3"),
        lintPrice = BigDecimal.ZERO,
        lintPercentage = BigDecimal("38"),
        lossPercentage = BigDecimal("13"),
        cottonseedPrice = BigDecimal("2.5"),
        processingFee = BigDecimal("1000"),
        laborFee = BigDecimal.ZERO,
        warehouseFee = BigDecimal.ZERO,
        financeFee = BigDecimal.ZERO,
        subsidy = BigDecimal.ZERO,
    )
}
