<?php

use App\Support\Security\IdentityFields;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Seal passport numbers and dates of birth. Lookup hashes keep duplicate
 * matching working. Existing rows are encrypted in place — nothing is dropped.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->prepare('cip_people');
        $this->prepare('cbi_applications');
        $this->sealTable('cip_people');
        $this->sealTable('cbi_applications');
        $this->swap('cip_people');
        $this->swap('cbi_applications');
    }

    public function down(): void
    {
        // Forward-only: ciphertext cannot be restored to a date column safely
        // without the application key and a dedicated decrypt pass.
    }

    private function prepare(string $table): void
    {
        Schema::table($table, function (Blueprint $blueprint) {
            $blueprint->text('passport_number_cipher')->nullable();
            $blueprint->string('passport_number_lookup', 64)->nullable();
            $blueprint->text('date_of_birth_cipher')->nullable();
            $blueprint->string('date_of_birth_lookup', 64)->nullable();
        });
    }

    private function sealTable(string $table): void
    {
        DB::table($table)->orderBy('id')->chunkById(100, function ($rows) use ($table) {
            foreach ($rows as $row) {
                $passport = $row->passport_number !== null && $row->passport_number !== ''
                    ? (string) $row->passport_number
                    : null;
                $dob = $row->date_of_birth !== null && $row->date_of_birth !== ''
                    ? (string) $row->date_of_birth
                    : null;

                DB::table($table)->where('id', $row->id)->update([
                    'passport_number_cipher' => $passport !== null ? Crypt::encryptString($passport) : null,
                    'passport_number_lookup' => IdentityFields::lookup($passport),
                    'date_of_birth_cipher' => $dob !== null ? Crypt::encryptString($dob) : null,
                    'date_of_birth_lookup' => IdentityFields::lookup($dob),
                ]);
            }
        });
    }

    private function swap(string $table): void
    {
        Schema::table($table, function (Blueprint $blueprint) {
            $blueprint->dropColumn(['passport_number', 'date_of_birth']);
        });

        Schema::table($table, function (Blueprint $blueprint) {
            $blueprint->renameColumn('passport_number_cipher', 'passport_number');
            $blueprint->renameColumn('date_of_birth_cipher', 'date_of_birth');
        });

        Schema::table($table, function (Blueprint $blueprint) {
            $blueprint->index('passport_number_lookup');
            $blueprint->index('date_of_birth_lookup');
        });
    }
};
