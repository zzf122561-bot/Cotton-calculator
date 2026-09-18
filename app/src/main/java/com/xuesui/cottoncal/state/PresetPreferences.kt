package com.xuesui.cottoncal.state

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.xuesui.cottoncal.model.CottonPreset
import com.xuesui.cottoncal.model.PriceBasis

class PresetPreferences(context: Context) {
    private val preferences: SharedPreferences =
        context.getSharedPreferences("cotton_calculator", Context.MODE_PRIVATE)

    fun loadAppState(): AppUiState {
        val selected = runCatching {
            CottonPreset.valueOf(
                preferences.getString(KEY_SELECTED_PRESET, CottonPreset.HAND_PICKED.name)
                    ?: CottonPreset.HAND_PICKED.name,
            )
        }.getOrDefault(CottonPreset.HAND_PICKED)

        val states = CottonPreset.entries.associateWith(::loadPreset)
        return AppUiState(selectedPreset = selected, presets = states)
    }

    fun saveSelectedPreset(preset: CottonPreset) {
        preferences.edit { putString(KEY_SELECTED_PRESET, preset.name) }
    }

    fun savePreset(preset: CottonPreset, state: PresetUiState) {
        val prefix = preset.storageKey
        preferences.edit {
            putString(key(prefix, "seed"), state.seedCottonPrice)
            putString(key(prefix, "lint"), state.lintPrice)
            putString(key(prefix, "lint_percentage"), state.lintPercentage)
            putString(key(prefix, "loss_percentage"), state.lossPercentage)
            putString(key(prefix, "cottonseed"), state.cottonseedPrice)
            putString(key(prefix, "processing"), state.processingFee)
            putString(key(prefix, "labor"), state.laborFee)
            putString(key(prefix, "warehouse"), state.warehouseFee)
            putString(key(prefix, "finance"), state.financeFee)
            putString(key(prefix, "subsidy"), state.subsidy)
            putString(key(prefix, "basis"), state.basis.name)
            putBoolean(key(prefix, "expanded"), state.detailsExpanded)
        }
    }

    fun clearPreset(preset: CottonPreset) {
        val prefix = "${preset.storageKey}_"
        preferences.edit {
            preferences.all.keys.filter { it.startsWith(prefix) }.forEach(::remove)
        }
    }

    private fun loadPreset(preset: CottonPreset): PresetUiState {
        val defaults = PresetDefaults.state(preset)
        val prefix = preset.storageKey
        if (!preferences.contains(key(prefix, "basis"))) return defaults

        val basis = runCatching {
            PriceBasis.valueOf(
                preferences.getString(key(prefix, "basis"), defaults.basis.name)
                    ?: defaults.basis.name,
            )
        }.getOrDefault(defaults.basis)

        val restored = defaults.copy(
            seedCottonPrice = string(prefix, "seed", defaults.seedCottonPrice),
            lintPrice = string(prefix, "lint", defaults.lintPrice),
            lintPercentage = string(prefix, "lint_percentage", defaults.lintPercentage),
            lossPercentage = string(prefix, "loss_percentage", defaults.lossPercentage),
            cottonseedPrice = string(prefix, "cottonseed", defaults.cottonseedPrice),
            processingFee = string(prefix, "processing", defaults.processingFee),
            laborFee = string(prefix, "labor", defaults.laborFee),
            warehouseFee = string(prefix, "warehouse", defaults.warehouseFee),
            financeFee = string(prefix, "finance", defaults.financeFee),
            subsidy = string(prefix, "subsidy", defaults.subsidy),
            basis = basis,
            detailsExpanded = preferences.getBoolean(key(prefix, "expanded"), defaults.detailsExpanded),
            result = null,
            errors = emptyList(),
        )
        return CalculatorStateReducer.recalculate(restored)
    }

    private fun string(prefix: String, suffix: String, fallback: String): String =
        preferences.getString(key(prefix, suffix), fallback) ?: fallback

    private fun key(prefix: String, suffix: String) = "${prefix}_$suffix"

    private companion object {
        const val KEY_SELECTED_PRESET = "selected_preset"
    }
}
