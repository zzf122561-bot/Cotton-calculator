package com.xuesui.cottoncal.state

import com.xuesui.cottoncal.model.CalculationInputs
import com.xuesui.cottoncal.model.CalculationOutcome
import com.xuesui.cottoncal.model.CalculationResult
import com.xuesui.cottoncal.model.CottonCalculator
import com.xuesui.cottoncal.model.CottonPreset
import com.xuesui.cottoncal.model.InputField
import com.xuesui.cottoncal.model.PriceBasis
import com.xuesui.cottoncal.model.ValidationError
import java.math.BigDecimal

data class PresetUiState(
    val seedCottonPrice: String,
    val lintPrice: String,
    val lintPercentage: String,
    val lossPercentage: String,
    val cottonseedPrice: String,
    val processingFee: String,
    val laborFee: String,
    val warehouseFee: String,
    val financeFee: String,
    val subsidy: String,
    val basis: PriceBasis,
    val detailsExpanded: Boolean,
    val result: CalculationResult? = null,
    val errors: List<ValidationError> = emptyList(),
) {
    fun value(field: InputField): String = when (field) {
        InputField.SEED_COTTON_PRICE -> seedCottonPrice
        InputField.LINT_PRICE -> lintPrice
        InputField.LINT_PERCENTAGE -> lintPercentage
        InputField.LOSS_PERCENTAGE -> lossPercentage
        InputField.COTTONSEED_PRICE -> cottonseedPrice
        InputField.PROCESSING_FEE -> processingFee
        InputField.LABOR_FEE -> laborFee
        InputField.WAREHOUSE_FEE -> warehouseFee
        InputField.FINANCE_FEE -> financeFee
        InputField.SUBSIDY -> subsidy
    }

    fun errorFor(field: InputField): String? = errors.firstOrNull { it.field == field }?.message
}

data class AppUiState(
    val selectedPreset: CottonPreset = CottonPreset.HAND_PICKED,
    val presets: Map<CottonPreset, PresetUiState> = CottonPreset.entries.associateWith(PresetDefaults::state),
    val showResetDialog: Boolean = false,
) {
    val current: PresetUiState get() = presets.getValue(selectedPreset)
}

object PresetDefaults {
    fun state(preset: CottonPreset): PresetUiState {
        val state = when (preset) {
            CottonPreset.HAND_PICKED -> PresetUiState(
                seedCottonPrice = "6.73832884794535",
                lintPrice = "",
                lintPercentage = "40.6",
                lossPercentage = "2.5",
                cottonseedPrice = "2.24",
                processingFee = "800",
                laborFee = "0",
                warehouseFee = "91",
                financeFee = "0",
                subsidy = "100",
                basis = PriceBasis.SEED_COTTON,
                detailsExpanded = false,
            )
            CottonPreset.MACHINE_PICKED -> PresetUiState(
                seedCottonPrice = "7.3",
                lintPrice = "",
                lintPercentage = "38",
                lossPercentage = "13",
                cottonseedPrice = "2.5",
                processingFee = "1000",
                laborFee = "0",
                warehouseFee = "0",
                financeFee = "0",
                subsidy = "0",
                basis = PriceBasis.SEED_COTTON,
                detailsExpanded = false,
            )
        }
        return CalculatorStateReducer.recalculate(state)
    }
}

object CalculatorStateReducer {
    private val decimalPattern = Regex("^\\d*(?:\\.\\d*)?$")
    private val integerPattern = Regex("^\\d*$")

    fun edit(state: PresetUiState, field: InputField, rawValue: String): PresetUiState {
        val normalized = rawValue.trim().replace(",", "")
        val maxScale = when (field) {
            InputField.SEED_COTTON_PRICE -> 6
            InputField.LINT_PRICE -> 0
            InputField.LINT_PERCENTAGE, InputField.LOSS_PERCENTAGE -> 4
            InputField.COTTONSEED_PRICE -> 6
            else -> 2
        }
        if (!isAllowed(normalized, maxScale)) return state
        if (state.value(field) == normalized) return state

        var updated = setValue(state, field, normalized)
        if (field == InputField.SEED_COTTON_PRICE) updated = updated.copy(basis = PriceBasis.SEED_COTTON)
        if (field == InputField.LINT_PRICE) updated = updated.copy(basis = PriceBasis.LINT)
        return recalculate(updated)
    }

    fun recalculate(state: PresetUiState): PresetUiState {
        val parseErrors = mutableListOf<ValidationError>()
        fun parse(field: InputField): BigDecimal {
            val text = state.value(field)
            return text.toBigDecimalOrNull() ?: run {
                parseErrors += ValidationError(field, "请输入有效数字")
                BigDecimal.ZERO
            }
        }

        val seedPrice = if (state.basis == PriceBasis.SEED_COTTON) {
            parse(InputField.SEED_COTTON_PRICE)
        } else {
            state.seedCottonPrice.toBigDecimalOrNull() ?: BigDecimal.ZERO
        }
        val lintPrice = if (state.basis == PriceBasis.LINT) {
            parse(InputField.LINT_PRICE)
        } else {
            state.lintPrice.toBigDecimalOrNull() ?: BigDecimal.ZERO
        }
        val inputs = CalculationInputs(
            seedCottonPrice = seedPrice,
            lintPrice = lintPrice,
            lintPercentage = parse(InputField.LINT_PERCENTAGE),
            lossPercentage = parse(InputField.LOSS_PERCENTAGE),
            cottonseedPrice = parse(InputField.COTTONSEED_PRICE),
            processingFee = parse(InputField.PROCESSING_FEE),
            laborFee = parse(InputField.LABOR_FEE),
            warehouseFee = parse(InputField.WAREHOUSE_FEE),
            financeFee = parse(InputField.FINANCE_FEE),
            subsidy = parse(InputField.SUBSIDY),
        )
        if (parseErrors.isNotEmpty()) return state.copy(result = null, errors = parseErrors)

        return when (val outcome = CottonCalculator.calculate(inputs, state.basis)) {
            is CalculationOutcome.Invalid -> state.copy(result = null, errors = outcome.errors)
            is CalculationOutcome.Success -> {
                val result = outcome.result
                when (state.basis) {
                    PriceBasis.SEED_COTTON -> state.copy(
                        lintPrice = CottonCalculator.lintDisplay(result.lintPrice),
                        result = result,
                        errors = emptyList(),
                    )
                    PriceBasis.LINT -> state.copy(
                        seedCottonPrice = CottonCalculator.seedDisplay(result.seedCottonPrice),
                        result = result,
                        errors = emptyList(),
                    )
                }
            }
        }
    }

    private fun isAllowed(value: String, maxScale: Int): Boolean {
        val pattern = if (maxScale == 0) integerPattern else decimalPattern
        if (!pattern.matches(value)) return false
        val scale = value.substringAfter('.', "").length
        return scale <= maxScale
    }

    private fun setValue(state: PresetUiState, field: InputField, value: String): PresetUiState = when (field) {
        InputField.SEED_COTTON_PRICE -> state.copy(seedCottonPrice = value)
        InputField.LINT_PRICE -> state.copy(lintPrice = value)
        InputField.LINT_PERCENTAGE -> state.copy(lintPercentage = value)
        InputField.LOSS_PERCENTAGE -> state.copy(lossPercentage = value)
        InputField.COTTONSEED_PRICE -> state.copy(cottonseedPrice = value)
        InputField.PROCESSING_FEE -> state.copy(processingFee = value)
        InputField.LABOR_FEE -> state.copy(laborFee = value)
        InputField.WAREHOUSE_FEE -> state.copy(warehouseFee = value)
        InputField.FINANCE_FEE -> state.copy(financeFee = value)
        InputField.SUBSIDY -> state.copy(subsidy = value)
    }
}
