package com.xuesui.cottoncal.model

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

object CottonCalculator {
    private val mathContext = MathContext.DECIMAL128
    private val oneHundred = BigDecimal("100")
    private val oneThousand = BigDecimal("1000")

    fun calculate(inputs: CalculationInputs, basis: PriceBasis): CalculationOutcome {
        val errors = validate(inputs, basis)
        if (errors.isNotEmpty()) return CalculationOutcome.Invalid(errors)

        val lintRatio = inputs.lintPercentage.divide(oneHundred, mathContext)
        val lossRatio = inputs.lossPercentage.divide(oneHundred, mathContext)
        val cottonseedYield = BigDecimal.ONE
            .subtract(lintRatio, mathContext)
            .subtract(lossRatio, mathContext)
        val cottonseedDeduction = cottonseedYield.multiply(inputs.cottonseedPrice, mathContext)
        val netFees = inputs.processingFee
            .add(inputs.laborFee, mathContext)
            .add(inputs.warehouseFee, mathContext)
            .add(inputs.financeFee, mathContext)
            .subtract(inputs.subsidy, mathContext)

        val result = when (basis) {
            PriceBasis.SEED_COTTON -> {
                val netSeedCost = inputs.seedCottonPrice.subtract(cottonseedDeduction, mathContext)
                val rawLintCost = netSeedCost
                    .divide(lintRatio, mathContext)
                    .multiply(oneThousand, mathContext)
                val lintPrice = rawLintCost.add(netFees, mathContext)
                if (lintPrice < BigDecimal.ZERO) {
                    return CalculationOutcome.Invalid(
                        listOf(ValidationError(InputField.SUBSIDY, "费用和补贴使皮棉成本低于0，请检查参数")),
                    )
                }
                CalculationResult(
                    seedCottonPrice = inputs.seedCottonPrice,
                    lintPrice = lintPrice,
                    cottonseedYield = cottonseedYield,
                    cottonseedDeductionPerKg = cottonseedDeduction,
                    netSeedCostPerKg = netSeedCost,
                    rawLintCostPerTon = rawLintCost,
                    netFeesPerTon = netFees,
                )
            }

            PriceBasis.LINT -> {
                val rawLintCost = inputs.lintPrice.subtract(netFees, mathContext)
                val netSeedCost = rawLintCost
                    .divide(oneThousand, mathContext)
                    .multiply(lintRatio, mathContext)
                val seedPrice = netSeedCost.add(cottonseedDeduction, mathContext)
                if (seedPrice < BigDecimal.ZERO) {
                    return CalculationOutcome.Invalid(
                        listOf(ValidationError(InputField.LINT_PRICE, "目标皮棉价过低，反算出的籽棉价小于0")),
                    )
                }
                CalculationResult(
                    seedCottonPrice = seedPrice,
                    lintPrice = inputs.lintPrice,
                    cottonseedYield = cottonseedYield,
                    cottonseedDeductionPerKg = cottonseedDeduction,
                    netSeedCostPerKg = netSeedCost,
                    rawLintCostPerTon = rawLintCost,
                    netFeesPerTon = netFees,
                )
            }
        }

        return CalculationOutcome.Success(result)
    }

    fun lintDisplay(value: BigDecimal): String =
        value.setScale(0, RoundingMode.HALF_UP).toPlainString()

    fun seedDisplay(value: BigDecimal): String =
        value.setScale(2, RoundingMode.HALF_UP).toPlainString()

    private fun validate(inputs: CalculationInputs, basis: PriceBasis): List<ValidationError> {
        val errors = mutableListOf<ValidationError>()
        if (inputs.lintPercentage <= BigDecimal.ZERO || inputs.lintPercentage > oneHundred) {
            errors += ValidationError(InputField.LINT_PERCENTAGE, "衣分率必须大于0且不超过100%")
        }
        if (inputs.lossPercentage < BigDecimal.ZERO || inputs.lossPercentage > oneHundred) {
            errors += ValidationError(InputField.LOSS_PERCENTAGE, "损耗率必须在0%到100%之间")
        }
        if (inputs.lintPercentage.add(inputs.lossPercentage) > oneHundred) {
            errors += ValidationError(InputField.LOSS_PERCENTAGE, "衣分率与损耗率之和不能超过100%")
        }

        val nonNegative = listOf(
            InputField.COTTONSEED_PRICE to inputs.cottonseedPrice,
            InputField.PROCESSING_FEE to inputs.processingFee,
            InputField.LABOR_FEE to inputs.laborFee,
            InputField.WAREHOUSE_FEE to inputs.warehouseFee,
            InputField.FINANCE_FEE to inputs.financeFee,
            InputField.SUBSIDY to inputs.subsidy,
        )
        nonNegative.forEach { (field, value) ->
            if (value < BigDecimal.ZERO) {
                errors += ValidationError(field, "金额不能小于0")
            }
        }
        when (basis) {
            PriceBasis.SEED_COTTON -> if (inputs.seedCottonPrice < BigDecimal.ZERO) {
                errors += ValidationError(InputField.SEED_COTTON_PRICE, "籽棉价不能小于0")
            }
            PriceBasis.LINT -> if (inputs.lintPrice < BigDecimal.ZERO) {
                errors += ValidationError(InputField.LINT_PRICE, "皮棉价不能小于0")
            }
        }
        return errors
    }
}

