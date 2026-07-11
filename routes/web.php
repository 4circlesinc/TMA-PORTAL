<?php

use App\Http\Controllers\DashboardController;
use App\Http\Controllers\LegacyPageController;
use Illuminate\Support\Facades\Route;

Route::get('/', DashboardController::class);

Route::view('/demo/avatars', 'demo.avatars');

Route::get('/{page}', LegacyPageController::class)
    ->whereIn('page', LegacyPageController::PAGES);
