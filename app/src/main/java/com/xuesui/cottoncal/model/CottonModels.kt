package com.xuesui.cottoncal.model

import java.math.BigDecimal

enum class CottonPreset(val displayName: String, val storageKey: String) {
    HAND_PICKED("手摘棉", "hand"),
    MACHINE_PICKED("机采棉", "machine"),
}

enum class PriceBasis {
    SEED_COTTON,
    LINT,
}

enum class InputField {
    SEED_COTTON_PRICE,
    LINT_PRICE,
    LINT_PERCENTAGE,
    LOSS_PERCENTAGE,
    COTTONSEED_PRICE,
    PROCESSING_FEE,
    LABOR_FEE,
    WAREHOUSE_FEE,
    FINANCE_FEE,
    SUBSIDY,
}

data class CalculationInputs(
    val seedCottonPrice: BigDecimal,
    val lintPrice: BigDecimal,
    val lintPercentage: BigDecimal,
    val lossPercentage: BigDecimal,
    val cottonseedPrice: BigDecimal,
    val processingFee: BigDecimal,
    val laborFee: BigDecimal,
    val warehouseFee: BigDecimal,
    val financeFee: BigDecimal,
    val subsidy: BigDecimal,
)

data class CalculationResult(
    val seedCottonPrice: BigDecimal,
    val lintPrice: BigDecimal,
    val cottonseedYield: BigDecimal,
    val cottonseedDeductionPerKg: BigDecimal,
    val netSeedCostPerKg: BigDecimal,
    val rawLintCostPerTon: BigDecimal,
    val netFeesPerTon: BigDecimal,
)

data class ValidationError(
    val field: InputField,
    val message: String,
)

sealed interface CalculationOutcome {
    data class Success(val result: CalculationResult) : CalculationOutcome
    data class Invalid(val errors: List<ValidationError>) : CalculationOutcome
}

