<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Officer-ness moved to where the portal already keeps access: a live
     * staff assignment on a service provider carrying an officer role
     * (ClientAssignment::ROLES). The separate grant table lasted one day and
     * held no production data — the module is still dark behind FEATURE_CIP.
     */
    public function up(): void
    {
        Schema::dropIfExists('cip_officer_roles');
    }

    public function down(): void
    {
        Schema::create('cip_officer_roles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('role', 32);
            $table->foreignId('granted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['user_id', 'role']);
        });
    }
};
