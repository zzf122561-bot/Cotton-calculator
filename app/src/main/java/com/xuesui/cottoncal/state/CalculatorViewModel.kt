package com.xuesui.cottoncal.state

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import com.xuesui.cottoncal.model.CottonPreset
import com.xuesui.cottoncal.model.InputField

class CalculatorViewModel(application: Application) : AndroidViewModel(application) {
    private val preferences = PresetPreferences(application)

    var uiState by mutableStateOf(preferences.loadAppState())
        private set

    fun selectPreset(preset: CottonPreset) {
        if (preset == uiState.selectedPreset) return
        uiState = uiState.copy(selectedPreset = preset)
        preferences.saveSelectedPreset(preset)
    }

    fun edit(field: InputField, value: String) {
        val preset = uiState.selectedPreset
        val current = uiState.current
        val updated = CalculatorStateReducer.edit(current, field, value)
        if (updated == current) return
        uiState = uiState.copy(presets = uiState.presets + (preset to updated))
        preferences.savePreset(preset, updated)
    }

    fun toggleDetails() {
        val preset = uiState.selectedPreset
        val updated = uiState.current.copy(detailsExpanded = !uiState.current.detailsExpanded)
        uiState = uiState.copy(presets = uiState.presets + (preset to updated))
        preferences.savePreset(preset, updated)
    }

    fun requestReset() {
        uiState = uiState.copy(showResetDialog = true)
    }

    fun cancelReset() {
        uiState = uiState.copy(showResetDialog = false)
    }

    fun confirmReset() {
        val preset = uiState.selectedPreset
        preferences.clearPreset(preset)
        val defaults = PresetDefaults.state(preset)
        uiState = uiState.copy(
            presets = uiState.presets + (preset to defaults),
            showResetDialog = false,
        )
        preferences.savePreset(preset, defaults)
    }
}
