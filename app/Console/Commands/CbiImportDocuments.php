<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\Access\Role;
use App\Support\Cbi\DocumentImporter;
use Illuminate\Console\Command;

class CbiImportDocuments extends Command
{
    protected $signature = 'cbi:import-documents
                            {--actor= : Email of the staff member who will own the imported files}
                            {--limit= : Stop after this many documents (the run resumes where it left off)}
                            {--survey : Report what is waiting and stop}
                            {--force : Skip the size confirmation (for unattended runs)}';

    protected $description = 'Mirror CBI attachments into each client’s File Library folder';

    public function handle(): int
    {
        $actor = $this->actor();
        if (! $actor) {
            return self::FAILURE;
        }

        $survey = (new DocumentImporter($actor))->survey();
        $gb = round($survey['sizeKb'] / 1048576, 1);

        $this->table(['', 'Count'], [
            ['Documents waiting', number_format($survey['files'])],
            ['…of which reach a client', number_format($survey['files'] - $survey['orphaned'])],
            ['…with no client to file under', number_format($survey['orphaned'])],
            ['Clients receiving files', number_format($survey['clients'])],
            ['Already imported', number_format($survey['done'])],
            ['To transfer', $gb.' GB'],
        ]);

        if ($this->option('survey')) {
            return self::SUCCESS;
        }

        $limit = $this->option('limit') ? max(1, (int) $this->option('limit')) : null;
        $todo = $limit ? min($limit, $survey['files'] - $survey['orphaned']) : $survey['files'] - $survey['orphaned'];

        if ($todo < 1) {
            $this->info('Nothing to import.');

            return self::SUCCESS;
        }

        if (! $limit && $gb > 1 && ! $this->option('force')) {
            $this->warn(sprintf(
                'This will transfer about %s GB from Smartsheet and store it. Use --limit to do it in stages.',
                $gb
            ));
            if (! $this->confirm('Continue?', false)) {
                return self::SUCCESS;
            }
        }

        $importer = new DocumentImporter($actor);
        $bar = $this->output->createProgressBar($todo);
        $bar->start();
        $importer->import($limit, fn () => $bar->advance());
        $bar->finish();
        $this->newLine(2);

        $s = $importer->stats;
        $this->table(['', 'Count'], [
            ['Documents filed', number_format($s['imported'])],
            ['Client folders created', number_format($s['foldersCreated'])],
            ['Transferred', round($s['bytes'] / 1073741824, 2).' GB'],
            ['Links (nothing to mirror)', number_format($s['links'])],
            ['No client to file under', number_format($s['orphaned'])],
            ['Failed', number_format($s['failed'])],
        ]);

        foreach ($importer->errors as $error) {
            $this->line('  ! '.$error);
        }

        if ($s['failed']) {
            $this->warn('Failures stay unimported and are retried on the next run.');
        }

        return self::SUCCESS;
    }

    private function actor(): ?User
    {
        $email = $this->option('actor');
        if (! $email) {
            $this->error('--actor is required: an imported file has to be owned by somebody.');

            return null;
        }

        $user = User::where('email', str($email)->lower())->first();
        if (! $user) {
            $this->error('No user with that email.');

            return null;
        }

        if (! Role::isAdmin($user)) {
            $this->error($user->name.' is not an administrator, so they cannot own the client library’s imports.');

            return null;
        }

        return $user;
    }
}
