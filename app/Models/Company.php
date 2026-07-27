<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A firm client company. Contact persons live on `clients` and point here via
 * `company_id`.
 */
#[Fillable(['uid', 'name', 'website', 'notes', 'created_by'])]
class Company extends Model
{
    use SoftDeletes;

    protected function casts(): array
    {
        return [
            'deleted_at' => 'datetime',
        ];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function clients(): HasMany
    {
        return $this->hasMany(Client::class);
    }

    /**
     * @return array<string, mixed>
     */
    public function toRecord(): array
    {
        $people = $this->relationLoaded('clients')
            ? $this->clients
            : $this->clients()->orderBy('name')->get();

        return [
            'id' => $this->uid,
            'name' => $this->name,
            'website' => $this->website,
            'notes' => $this->notes,
            'peopleCount' => $people->count(),
            'people' => $people->map(fn (Client $c) => [
                'id' => $c->uid,
                'name' => $c->name,
                'initial' => $c->initial,
                'initialColor' => $c->initial_color,
                'email' => $c->email,
                'hasLogin' => $c->user_id !== null,
            ])->values()->all(),
        ];
    }
}
